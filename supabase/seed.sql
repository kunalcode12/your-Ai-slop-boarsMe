-- =============================================================================
-- Local dev seed. Applied automatically by `supabase db reset`.
-- A few fake players + queued prompts so the queue/matchmaking can be exercised
-- without standing up the chain. credits_cached here is just a cache value.
-- Idempotent: safe to run repeatedly.
-- =============================================================================

-- fixed ids so prompts can reference players deterministically
insert into players (id, wallet_pubkey, credits_cached, reputation) values
  ('00000000-0000-0000-0000-000000000001', 'SeedPlayerAlice1111111111111111111111111111', 3, 100),
  ('00000000-0000-0000-0000-000000000002', 'SeedPlayerBob22222222222222222222222222222',  5, 100),
  ('00000000-0000-0000-0000-000000000003', 'SeedPlayerCarol333333333333333333333333333',  1, 40)  -- low rep -> shadow-throttle test
on conflict (id) do nothing;

-- a handful of queued prompts (expire 5 min out, mirrors PROMPT_EXPIRY_MS)
insert into prompts (id, requester_id, type, body, status, credits_cost, expires_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'text',
    'explain quantum computing but like im a golden retriever', 'queued', 1, now() + interval '5 minutes'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'text',
    'write a haiku about being out of credits', 'queued', 1, now() + interval '5 minutes'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'image',
    'draw a cat wearing a tiny hat', 'queued', 2, now() + interval '5 minutes')
on conflict (id) do nothing;
