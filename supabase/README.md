# supabase — schema, migrations, storage

The **backend is the only database client**, connecting with the **service role**
key. Browsers never touch the DB. RLS is enabled with no policies, so every
public-facing role (anon/authenticated) is denied; the service role bypasses RLS.

## layout

```
supabase/
  migrations/
    20260618120000_init.sql       # enums, tables, indexes
    20260618120100_functions.sql  # RPCs (atomic claim, expiry, etc.) + revokes
    20260618120200_rls.sql        # enable RLS everywhere, no policies
    20260618120300_storage.sql    # private drawings bucket
  seed.sql                        # fake players/prompts for local dev
```

## prerequisites

- Supabase CLI installed (`supabase --version`)
- a Supabase project (free tier is fine) for the hosted dev DB, **or** Docker for
  the local stack

## apply migrations to a hosted dev project

```bash
# from repo root
supabase init                       # safe if already init'd; keeps migrations/
supabase link --project-ref <your-project-ref>
supabase db push                    # applies everything in migrations/ in order
```

`db push` also creates the storage bucket (the storage migration inserts into
`storage.buckets`).

## run the full stack locally (optional)

```bash
supabase start                      # boots Postgres + Storage + Studio in Docker
supabase db reset                   # rebuild local DB from migrations/ + seed.sql
# ...later, after editing migrations:
supabase db reset                   # re-apply from scratch (re-runs seed.sql)
```

`supabase start` prints the local `API URL` and `service_role` key — put them in
`.env` as `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` for the backend.

## (optional) regenerate the typed Database from the live schema

The data layer ships a hand-written `Database` type in
`apps/server/src/db/types.ts`. To replace it with a generated one:

```bash
supabase gen types typescript --linked > apps/server/src/db/database.types.ts
```

Then point `apps/server/src/db/client.ts` at the generated type. (Hand-written is
the default so the repo builds without a live project.)

## storage bucket

- **id/name:** `slop-drawings` (must match `SUPABASE_STORAGE_BUCKET`)
- **private**, 2 MB limit, `image/png` only
- backend uploads with the service role and serves **short-lived signed URLs**;
  hiding a reported answer just stops new signed URLs from being minted
