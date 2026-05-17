import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const SUPABASE_URL = "https://myxiomacezwqkybaxwhz.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_GLnXvwnDaIKrg84ifYcHUA_GxXqmQAJ";

let supabaseClient = null;

export function getSupabaseClient() {
  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    });
  }

  return supabaseClient;
}

export default getSupabaseClient();