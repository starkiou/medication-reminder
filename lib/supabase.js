const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY manquantes dans les variables d\'environnement');
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

module.exports = { getSupabase };
