-- =============================================================================
-- your ai slop bores me — initial schema
-- Enums, tables, indexes. Column types/enums are reconciled with @slop/shared:
--   PromptType  -> prompt_type   ('text' | 'image')
--   AnswerType  -> answer_type   ('text' | 'image')
--   PromptStatus-> prompt_status ('queued'|'claimed'|'answered'|'expired'|'flagged')
--   CreditChangeReason -> credit_reason ('spend'|'earn'|'refill'|'refund')
--
-- NOTE ON CREDITS: players.credits_cached and the credit_ledger are an OFF-CHAIN
-- mirror/audit only. The on-chain credits program (PROMPT 3) is the real source
-- of truth; PROMPT 4 reconciles the cache against the chain on read. Treat reads
-- of credits_cached as advisory.
-- =============================================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- enums (idempotent)
-- ---------------------------------------------------------------------------
do $$ begin create type prompt_type   as enum ('text', 'image');                                  exception when duplicate_object then null; end $$;
do $$ begin create type answer_type   as enum ('text', 'image');                                  exception when duplicate_object then null; end $$;
do $$ begin create type prompt_status as enum ('queued', 'claimed', 'answered', 'expired', 'flagged'); exception when duplicate_object then null; end $$;
do $$ begin create type credit_reason as enum ('spend', 'earn', 'refill', 'refund');              exception when duplicate_object then null; end $$;
do $$ begin create type report_target as enum ('prompt', 'answer');                               exception when duplicate_object then null; end $$;
do $$ begin create type report_status as enum ('open', 'actioned', 'dismissed');                  exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- players
-- keyed by burner (or connected) pubkey. counters + reputation + moderation flags.
-- ---------------------------------------------------------------------------
create table if not exists players (
  id                  uuid primary key default gen_random_uuid(),
  wallet_pubkey       text not null unique,
  credits_cached      int  not null default 3,   -- @slop/shared STARTING_CREDITS
  last_refill_at      timestamptz not null default now(),
  answers_given       int  not null default 0,
  prompts_sent        int  not null default 0,
  -- DEVIATION: PROMPT 2 said "default 0", but @slop/shared models reputation as
  -- starting at REPUTATION_START (100) with a SHADOW_THROTTLE_THRESHOLD of 50 and
  -- subtractive penalties. We default to 100 to keep the shared model coherent.
  reputation          int  not null default 100,
  claim_cooldown_until timestamptz,
  banned              boolean not null default false,
  created_at          timestamptz not null default now()
);

create index if not exists players_wallet_pubkey_idx on players (wallet_pubkey);

-- ---------------------------------------------------------------------------
-- prompts (the matchmaking queue lives here)
-- ---------------------------------------------------------------------------
create table if not exists prompts (
  id            uuid primary key default gen_random_uuid(),
  requester_id  uuid not null references players (id) on delete cascade,
  type          prompt_type not null,
  body          text not null,
  status        prompt_status not null default 'queued',
  credits_cost  int  not null,
  claimed_by    uuid references players (id) on delete set null,
  claimed_at    timestamptz,
  expires_at    timestamptz not null,          -- unclaimed-expiry deadline
  created_at    timestamptz not null default now()
);

-- matchmaking + lifecycle scans
create index if not exists prompts_status_created_idx on prompts (status, created_at);
-- the hot path: oldest queued prompt. partial index keeps it tiny + fast.
create index if not exists prompts_queued_idx on prompts (created_at) where status = 'queued';
create index if not exists prompts_requester_idx on prompts (requester_id);
create index if not exists prompts_claimed_by_idx on prompts (claimed_by);

-- ---------------------------------------------------------------------------
-- answers (one per prompt). drawings live in storage; we keep the URL.
-- ---------------------------------------------------------------------------
create table if not exists answers (
  id            uuid primary key default gen_random_uuid(),
  prompt_id     uuid not null references prompts (id) on delete cascade,
  answerer_id   uuid not null references players (id) on delete cascade,
  type          answer_type not null,
  body_text     text,
  image_url     text,
  time_taken_ms int not null default 0,
  delivered     boolean not null default false,
  flagged       boolean not null default false,
  created_at    timestamptz not null default now()
);

-- one accepted answer per prompt
create unique index if not exists answers_prompt_unique_idx on answers (prompt_id);
create index if not exists answers_answerer_idx on answers (answerer_id);
-- undelivered lookup on requester reconnect
create index if not exists answers_undelivered_idx on answers (delivered) where delivered = false;

-- ---------------------------------------------------------------------------
-- credit_ledger — off-chain audit mirror of on-chain credit movements
-- ---------------------------------------------------------------------------
create table if not exists credit_ledger (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references players (id) on delete cascade,
  delta       int  not null,
  reason      credit_reason not null,
  onchain_sig text,                  -- the settling on-chain tx signature, when known
  created_at  timestamptz not null default now()
);

create index if not exists credit_ledger_player_idx on credit_ledger (player_id, created_at);

-- ---------------------------------------------------------------------------
-- reports — moderation
-- ---------------------------------------------------------------------------
create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  target_type report_target not null,
  target_id   uuid not null,
  reporter_id uuid not null references players (id) on delete cascade,
  reason      text,
  status      report_status not null default 'open',
  created_at  timestamptz not null default now()
);

create index if not exists reports_target_idx on reports (target_type, target_id);
-- one report per (reporter, target) so a single user can't inflate the count
create unique index if not exists reports_reporter_target_unique_idx
  on reports (reporter_id, target_type, target_id);

-- ---------------------------------------------------------------------------
-- sessions (optional) — session keys for gasless on-chain credit ops
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references players (id) on delete cascade,
  session_pubkey text not null,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now()
);

create index if not exists sessions_player_idx on sessions (player_id);
create index if not exists sessions_pubkey_idx on sessions (session_pubkey);
