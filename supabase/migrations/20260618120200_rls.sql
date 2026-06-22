-- =============================================================================
-- Row Level Security posture.
--
-- The backend is the ONLY database client and it connects with the Supabase
-- SERVICE ROLE key. The service role BYPASSES RLS entirely, so it keeps full
-- access regardless of policies.
--
-- We therefore enable RLS on every table and add NO policies. With RLS enabled
-- and no permissive policy, the anon and authenticated roles (i.e. anything a
-- browser could ever reach via the public Supabase API) are denied all access.
-- This is the lock-everything-to-the-backend posture the spec calls for.
--
-- `force row level security` is added so the rule also applies to the table
-- owner, leaving the service role as the only path in.
-- =============================================================================

alter table players       enable row level security;
alter table prompts       enable row level security;
alter table answers       enable row level security;
alter table credit_ledger enable row level security;
alter table reports       enable row level security;
alter table sessions      enable row level security;

alter table players       force row level security;
alter table prompts       force row level security;
alter table answers       force row level security;
alter table credit_ledger force row level security;
alter table reports       force row level security;
alter table sessions      force row level security;

-- Belt-and-braces: drop direct table privileges from the public-facing roles.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- NOTE: deliberately NO CREATE POLICY statements. Adding any permissive policy
-- here would open a hole for anon/authenticated. Keep this file policy-free.
