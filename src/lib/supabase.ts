import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/src/lib/env";

let cachedClient: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const env = getEnv();
  cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return cachedClient;
}

export function resetSupabaseClientForTests(): void {
  cachedClient = null;
}
