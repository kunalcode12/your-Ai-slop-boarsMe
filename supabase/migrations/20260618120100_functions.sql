-- =============================================================================
-- RPC functions.
-- The concurrency-sensitive operations (atomic claim, expiry sweep, answer
-- submission guard, credit/ledger writes) live here as Postgres functions
-- because doing them in JS races across many simultaneous players.
--
-- All functions are SECURITY INVOKER. Only the backend (service role, which
-- bypasses RLS) is meant to call them, so at the bottom we REVOKE EXECUTE from
-- anon/authenticated/public to keep them off the PostgREST surface.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- apply_credit_delta — atomically update the cached balance + append a ledger row.
-- Returns the new cached balance. Lower-clamped at 0 (cache hygiene only; the
-- chain is the real source of truth). reason/onchain_sig feed the audit trail.
-- ---------------------------------------------------------------------------
create or replace function apply_credit_delta(
  p_player_id   uuid,
  p_delta       int,
  p_reason      credit_reason,
  p_onchain_sig text default null
) returns int
language plpgsql
as $$
declare
  v_new int;
begin
  update players
     set credits_cached = greatest(0, credits_cached + p_delta)
   where id = p_player_id
  returning credits_cached into v_new;

  if v_new is null then
    raise exception 'apply_credit_delta: player % not found', p_player_id;
  end if;

  insert into credit_ledger (player_id, delta, reason, onchain_sig)
  values (p_player_id, p_delta, p_reason, p_onchain_sig);

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- adjust_reputation — relative reputation change, lower-clamped at 0.
-- ---------------------------------------------------------------------------
create or replace function adjust_reputation(
  p_player_id uuid,
  p_delta     int
) returns int
language plpgsql
as $$
declare
  v_new int;
begin
  update players
     set reputation = greatest(0, reputation + p_delta)
   where id = p_player_id
  returning reputation into v_new;

  if v_new is null then
    raise exception 'adjust_reputation: player % not found', p_player_id;
  end if;

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_prompt — insert a queued prompt and bump the requester's prompts_sent
-- in one transaction. Returns the new prompt row.
-- (Credit spend itself is on-chain + apply_credit_delta, done by the backend.)
-- ---------------------------------------------------------------------------
create or replace function create_prompt(
  p_requester_id uuid,
  p_type         prompt_type,
  p_body         text,
  p_credits_cost int,
  p_expires_at   timestamptz
) returns setof prompts
language plpgsql
as $$
declare
  v_prompt prompts;
begin
  insert into prompts (requester_id, type, body, status, credits_cost, expires_at)
  values (p_requester_id, p_type, p_body, 'queued', p_credits_cost, p_expires_at)
  returning * into v_prompt;

  update players set prompts_sent = prompts_sent + 1 where id = p_requester_id;

  return next v_prompt;
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_next_prompt — THE ATOMIC CLAIM.
-- Hands the oldest queued, non-expired prompt that the answerer did NOT write to
-- exactly one caller. Concurrency-safe under many simultaneous answerers:
--   * the inner SELECT ... FOR UPDATE SKIP LOCKED locks the single candidate row
--     and makes concurrent claimers skip it (no two answerers get the same one),
--   * the outer UPDATE flips it to 'claimed' and RETURNS it atomically.
-- Returns 0 rows when the queue has nothing eligible.
-- (Caller is expected to have already checked ban / claim_cooldown_until / rate
-- limits — those drive distinct client responses, so they stay in the backend.)
-- ---------------------------------------------------------------------------
create or replace function claim_next_prompt(
  p_answerer_id uuid
) returns setof prompts
language sql
as $$
  update prompts
     set status     = 'claimed',
         claimed_by = p_answerer_id,
         claimed_at = now()
   where id = (
     select id
       from prompts
      where status = 'queued'
        and requester_id <> p_answerer_id   -- never your own prompt
        and expires_at > now()              -- not already stale
      order by created_at asc               -- fairness: oldest first
      for update skip locked
      limit 1
   )
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- submit_answer — guarded answer write.
-- Locks the prompt and only accepts the answer if this answerer still holds a
-- valid, in-time claim. Inserts the answer, marks the prompt 'answered', and
-- bumps the answerer's answers_given — all atomically. Returns 0 rows if the
-- claim is invalid/expired (backend maps that to deadline_passed / not_your_work).
-- (The +1 credit EARN is on-chain + apply_credit_delta, done by the backend
-- after this succeeds.)
-- ---------------------------------------------------------------------------
create or replace function submit_answer(
  p_prompt_id     uuid,
  p_answerer_id   uuid,
  p_type          answer_type,
  p_body_text     text,
  p_image_url     text,
  p_time_taken_ms int,
  p_time_limit_ms int
) returns setof answers
language plpgsql
as $$
declare
  v_prompt prompts;
  v_answer answers;
begin
  select * into v_prompt from prompts where id = p_prompt_id for update;

  if v_prompt.id is null then return; end if;                       -- no such prompt
  if v_prompt.status <> 'claimed' then return; end if;              -- not in answerable state
  if v_prompt.claimed_by is distinct from p_answerer_id then return; end if; -- not your work
  if v_prompt.claimed_at + make_interval(secs => p_time_limit_ms / 1000.0) < now() then
    return;                                                          -- deadline passed
  end if;

  insert into answers (prompt_id, answerer_id, type, body_text, image_url, time_taken_ms)
  values (p_prompt_id, p_answerer_id, p_type, p_body_text, p_image_url, p_time_taken_ms)
  returning * into v_answer;

  update prompts set status = 'answered' where id = p_prompt_id;
  update players set answers_given = answers_given + 1 where id = p_answerer_id;

  return next v_answer;
end;
$$;

-- ---------------------------------------------------------------------------
-- expire_stale_prompts — flip every queued+overdue prompt to 'expired' and
-- return the affected rows so the backend can refund each requester (the refund
-- is on-chain + apply_credit_delta; we only change status here).
-- ---------------------------------------------------------------------------
create or replace function expire_stale_prompts()
returns setof prompts
language sql
as $$
  update prompts
     set status = 'expired'
   where id in (
     select id
       from prompts
      where status = 'queued'
        and expires_at <= now()
      for update skip locked
   )
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- get_undelivered_answers_for_requester — answers waiting for a requester who
-- was offline when they arrived (delivered on reconnect). Hidden answers excluded.
-- ---------------------------------------------------------------------------
create or replace function get_undelivered_answers_for_requester(
  p_requester_id uuid
) returns setof answers
language sql
as $$
  select a.*
    from answers a
    join prompts p on p.id = a.prompt_id
   where p.requester_id = p_requester_id
     and a.delivered = false
     and a.flagged   = false
   order by a.created_at asc;
$$;

-- ---------------------------------------------------------------------------
-- hide_target_if_over_threshold — moderation auto-hide. Counts reports against a
-- target and, if at/over the threshold, hides it (answer.flagged=true, or
-- prompt.status='flagged'). Returns whether it hid the target.
-- ---------------------------------------------------------------------------
create or replace function hide_target_if_over_threshold(
  p_target_type report_target,
  p_target_id   uuid,
  p_threshold   int
) returns boolean
language plpgsql
as $$
declare
  v_count  int;
  v_hidden boolean := false;
begin
  select count(*) into v_count
    from reports
   where target_type = p_target_type and target_id = p_target_id;

  if v_count >= p_threshold then
    if p_target_type = 'answer' then
      update answers set flagged = true where id = p_target_id;
    else
      update prompts set status = 'flagged' where id = p_target_id;
    end if;
    v_hidden := true;
  end if;

  return v_hidden;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lock the RPC surface: only the service role (which bypasses these grants) may
-- call. Keeps the functions off the public PostgREST API.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'apply_credit_delta(uuid,int,credit_reason,text)',
    'adjust_reputation(uuid,int)',
    'create_prompt(uuid,prompt_type,text,int,timestamptz)',
    'claim_next_prompt(uuid)',
    'submit_answer(uuid,uuid,answer_type,text,text,int,int)',
    'expire_stale_prompts()',
    'get_undelivered_answers_for_requester(uuid)',
    'hide_target_if_over_threshold(report_target,uuid,int)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon, authenticated;', fn);
  end loop;
end $$;
