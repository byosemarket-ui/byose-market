const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = String(process.env.SUPABASE_URL || 'https://myxiomacezwqkybaxwhz.supabase.co').trim();
const SUPABASE_PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_GLnXvwnDaIKrg84ifYcHUA_GxXqmQAJ').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

let publishableClient = null;
let serviceRoleClient = null;

function assertBaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Supabase configuration is incomplete. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
  }
}

function getSupabaseClient() {
  assertBaseConfig();

  if (!publishableClient) {
    publishableClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return publishableClient;
}

function getServiceRoleSupabaseClient() {
  assertBaseConfig();

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server-side writes, storage management, and policy-safe admin mutations.');
  }

  if (!serviceRoleClient) {
    serviceRoleClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return serviceRoleClient;
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
  getSupabaseClient,
  getServiceRoleSupabaseClient
};