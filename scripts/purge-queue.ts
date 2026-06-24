/**
 * One-time maintenance: drain the prompt queue of accumulated "zombie" prompts
 * (old queued/claimed prompts from past test sessions that keep getting served
 * ahead of fresh questions). Flips every queued/claimed prompt to 'expired'.
 *
 * Safe to run anytime; it only affects not-yet-answered prompts. Run:
 *   pnpm --filter @slop/server exec tsx C:\Users\TGF\Downloads\aiSlop\scripts\purge-queue.ts
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

const here = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(here, "../.env") });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in .env");

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  const { data: before, error: e1 } = await db
    .from("prompts")
    .select("id, body, status, created_at")
    .in("status", ["queued", "claimed"]);
  if (e1) throw new Error(e1.message);

  console.log(`found ${before?.length ?? 0} unanswered prompt(s) in queue/claimed:`);
  for (const p of before ?? []) {
    console.log(`  - [${p.status}] ${JSON.stringify((p.body ?? "").slice(0, 40))}  (${p.created_at})`);
  }

  if (!before || before.length === 0) {
    console.log("nothing to purge. ✅");
    process.exit(0);
  }

  const { error: e2, count } = await db
    .from("prompts")
    .update({ status: "expired", claimed_by: null, claimed_at: null }, { count: "exact" })
    .in("status", ["queued", "claimed"]);
  if (e2) throw new Error(e2.message);

  console.log(`\n✅ purged ${count ?? before.length} prompt(s) → 'expired'. queue is clean.`);
  process.exit(0);
}
main().catch((e) => {
  console.error("❌ purge failed:", e?.message || e);
  process.exit(1);
});
