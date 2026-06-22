/**
 * Service-role Supabase client. The backend is the ONLY DB client; this key
 * bypasses RLS, so it must never reach the browser.
 *
 * The client is created lazily so importing the data layer doesn't require env
 * to be present (e.g. during typecheck/tests). `getDb()` throws a clear error if
 * the required vars are missing at first use.
 */

import { createClient, type SupabaseClient, type PostgrestError } from "@supabase/supabase-js";
import type { Database } from "./types";

export type SlopDb = SupabaseClient<Database>;

let client: SlopDb | null = null;

export function getDb(): SlopDb {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "db: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (service role).",
    );
  }

  client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

/** For tests: inject a client (e.g. a mock or a fresh service-role client). */
export function setDb(db: SlopDb): void {
  client = db;
}

/** Throw a labelled error on any PostgREST failure; otherwise narrow `data`. */
export function unwrap<T>(
  op: string,
  result: { data: T | null; error: PostgrestError | null },
): T {
  if (result.error) {
    throw new Error(`${op}: ${result.error.message}`);
  }
  if (result.data === null) {
    throw new Error(`${op}: unexpected null result`);
  }
  return result.data;
}
