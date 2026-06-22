-- =============================================================================
-- Storage bucket for answer drawing PNGs.
--
-- DECISION: PRIVATE bucket + short-lived backend-signed URLs (NOT public-read).
-- Justification: drawings are user-generated content from strangers. Moderation
-- requires that we can revoke access the instant something is reported/hidden. A
-- public-read bucket (even with unguessable keys) leaks permanently once a URL is
-- shared and can't be un-shared, which defeats takedown. With a private bucket,
-- the backend (service role) uploads the PNG and hands the requester a signed URL
-- with a short TTL; hiding an answer simply means we stop minting URLs for it.
--
-- Bucket id: the backend reads the name from SUPABASE_STORAGE_BUCKET (default
-- 'slop-drawings'). If you change the env value, change the id below to match.
--
-- Access pattern (implemented in PROMPT 4):
--   upload:  service role -> storage.from(bucket).upload(key, pngBytes)
--   serve:   service role -> storage.from(bucket).createSignedUrl(key, ttl)
--   key:     e.g. `${answerId}.png` (answers are 1:1 with prompts)
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'slop-drawings',
  'slop-drawings',
  false,                       -- PRIVATE
  2097152,                     -- 2 MB, mirrors @slop/shared MAX_DRAWING_BYTES
  array['image/png']
)
on conflict (id) do nothing;

-- No storage.objects policies are created: with RLS on storage.objects (the
-- Supabase default) and no policy for anon/authenticated, only the service role
-- can read/write objects in this bucket. That is exactly what we want.
