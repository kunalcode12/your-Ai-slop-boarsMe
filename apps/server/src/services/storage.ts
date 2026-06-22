/**
 * Drawing storage over the private Supabase bucket. We store the OBJECT PATH in
 * answers.image_url and mint short-lived signed URLs at delivery time, so hiding
 * a reported answer simply means we stop minting URLs for it.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StorageService } from "../types";

const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

export class SupabaseStorage implements StorageService {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string,
  ) {}

  async uploadDrawing(promptId: string, png: Buffer): Promise<string> {
    const path = `${promptId}/${randomUUID()}.png`;
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, png, { contentType: "image/png", upsert: false });
    if (error) throw new Error(`uploadDrawing: ${error.message}`);
    return path;
  }

  async signedUrl(path: string): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) throw new Error(`signedUrl: ${error?.message ?? "no url"}`);
    return data.signedUrl;
  }
}
