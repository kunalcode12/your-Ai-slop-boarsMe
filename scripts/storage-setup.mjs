// Create the private drawings storage bucket via the service-role key (HTTPS,
// no DB password needed). Idempotent. Mirrors supabase/migrations/..._storage.sql
// so storage is ready even before the SQL migrations are applied.
//
//   pnpm storage:setup

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "slop-drawings";

if (!url || !key) {
  console.error("✗ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const opts = {
  public: false, // PRIVATE — backend serves short-lived signed URLs
  fileSizeLimit: 2 * 1024 * 1024, // 2 MB, mirrors @slop/shared MAX_DRAWING_BYTES
  allowedMimeTypes: ["image/png"],
};

async function main() {
  console.log(`Ensuring storage bucket '${bucket}' on ${url} ...`);
  const { error } = await supabase.storage.createBucket(bucket, opts);

  if (error) {
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("already exists")) {
      // ensure settings are correct
      const { error: upErr } = await supabase.storage.updateBucket(bucket, opts);
      if (upErr) throw upErr;
      console.log("✓ bucket already existed — settings ensured (private, 2MB, image/png)");
    } else {
      throw error;
    }
  } else {
    console.log("✓ bucket created (private, 2MB, image/png)");
  }

  const { data: list, error: listErr } = await supabase.storage.listBuckets();
  if (listErr) throw listErr;
  const b = list.find((x) => x.id === bucket);
  console.log("  status:", b ? JSON.stringify({ id: b.id, public: b.public }) : "not found?!");
}

main().catch((e) => {
  console.error("✗ storage setup error:", e.message);
  process.exit(1);
});
