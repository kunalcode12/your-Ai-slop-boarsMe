// Apply SQL migrations (and optionally seed) to the Supabase Postgres via a
// direct connection. DDL needs the DB password — the service-role key cannot do
// this. Uses DIRECT_URL (session-mode pooler, port 5432), which supports DDL.
//
//   pnpm db:push          # apply supabase/migrations/*.sql in order
//   pnpm db:push --seed   # ...then apply supabase/seed.sql
//
// Migrations are written to be idempotent, so re-running is safe.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const migrationsDir = join(root, "supabase", "migrations");
const seedFile = join(root, "supabase", "seed.sql");

const conn = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!conn) {
  console.error("✗ DIRECT_URL (or DATABASE_URL) is not set in .env");
  process.exit(1);
}
if (conn.includes("[YOUR-PASSWORD]")) {
  console.error(
    "✗ The DB password is still a placeholder.\n" +
      "  Edit .env and replace [YOUR-PASSWORD] in DIRECT_URL with the Supabase database password\n" +
      "  (Supabase dashboard → Project Settings → Database → Connection string / reset password).",
  );
  process.exit(1);
}

const runSeed = process.argv.includes("--seed");

const client = new pg.Client({
  connectionString: conn,
  ssl: { rejectUnauthorized: false }, // Supabase pooler uses SSL
});

async function runFile(label, sql) {
  process.stdout.write(`  → ${label} ... `);
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log("ok");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    console.log("FAILED");
    throw e;
  }
}

async function main() {
  console.log(`Applying migrations to ${conn.replace(/:[^:@/]*@/, ":****@")}`);
  await client.connect();

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.error("✗ no .sql files found in supabase/migrations");
    process.exit(1);
  }

  for (const f of files) {
    await runFile(`migrations/${f}`, readFileSync(join(migrationsDir, f), "utf8"));
  }

  if (runSeed) {
    await runFile("seed.sql", readFileSync(seedFile, "utf8"));
  }

  await client.end();
  console.log("✓ migrations applied");
}

main().catch((e) => {
  console.error("\n✗ migration error:", e.message);
  client.end().catch(() => {});
  process.exit(1);
});
