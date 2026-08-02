import { supabaseAdmin } from "@/integrations/supabase/client.server";

type CachedContext = { at: number; text: string };
let cache: CachedContext | null = null;
const TTL_MS = 60_000;

/**
 * Live platform context for the support chatbot.
 * Reads the current schema, fee and stats from the database so the assistant
 * stays in sync with data/schema changes without prompt edits.
 */
export async function getSupportContext(): Promise<string> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.text;

  try {
    const { data, error } = await supabaseAdmin.rpc("support_context");
    if (error) throw new Error(error.message);
    const text = `LIVE PLATFORM CONTEXT (auto-synced from the database, do not contradict it):\n${JSON.stringify(
      data,
    )}`;
    cache = { at: Date.now(), text };
    return text;
  } catch {
    return "LIVE PLATFORM CONTEXT unavailable right now; answer from general TrustLance knowledge and avoid quoting exact numbers.";
  }
}
