// Verify the applied schema: tables, RPC functions, RLS state, storage bucket.
// Uses DIRECT_URL (needs the DB password).
//
//   pnpm db:verify

import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const conn = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!conn || conn.includes("[YOUR-PASSWORD]")) {
  console.error("✗ DIRECT_URL not set or password still a placeholder (see .env).");
  process.exit(1);
}

const EXPECT_TABLES = [
  "players",
  "prompts",
  "answers",
  "credit_ledger",
  "reports",
  "sessions",
];
const EXPECT_FUNCS = [
  "apply_credit_delta",
  "adjust_reputation",
  "create_prompt",
  "claim_next_prompt",
  "submit_answer",
  "expire_stale_prompts",
  "get_undelivered_answers_for_requester",
  "hide_target_if_over_threshold",
];

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  const tables = (
    await client.query(
      "select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename",
    )
  ).rows;
  const tableNames = tables.map((t) => t.tablename);

  console.log("Tables (public):");
  for (const t of EXPECT_TABLES) {
    const found = tables.find((x) => x.tablename === t);
    console.log(
      `  ${found ? "✓" : "✗"} ${t}${found ? `  (RLS ${found.rowsecurity ? "on" : "OFF"})` : " MISSING"}`,
    );
  }
  const extra = tableNames.filter((t) => !EXPECT_TABLES.includes(t));
  if (extra.length) console.log("  (other tables:", extra.join(", "), ")");

  const funcs = (
    await client.query(
      "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by proname",
    )
  ).rows.map((r) => r.proname);
  console.log("\nRPC functions (public):");
  for (const f of EXPECT_FUNCS) {
    console.log(`  ${funcs.includes(f) ? "✓" : "✗"} ${f}`);
  }

  const enums = (
    await client.query(
      "select t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e' order by t.typname",
    )
  ).rows.map((r) => r.typname);
  console.log("\nEnums:", enums.join(", ") || "(none)");

  const bucket = await client.query(
    "select id, public, file_size_limit from storage.buckets where id='slop-drawings'",
  );
  console.log(
    "\nStorage bucket 'slop-drawings':",
    bucket.rows[0]
      ? `✓ present (public=${bucket.rows[0].public}, limit=${bucket.rows[0].file_size_limit})`
      : "✗ MISSING",
  );

  // quick row counts if tables exist
  if (EXPECT_TABLES.every((t) => tableNames.includes(t))) {
    const counts = {};
    for (const t of ["players", "prompts", "answers"]) {
      counts[t] = (await client.query(`select count(*)::int as c from ${t}`)).rows[0].c;
    }
    console.log("\nRow counts:", JSON.stringify(counts));
  }

  await client.end();
  console.log("\n✓ verify complete");
}

main().catch((e) => {
  console.error("✗ verify error:", e.message);
  client.end().catch(() => {});
  process.exit(1);
});
