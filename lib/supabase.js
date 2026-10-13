let client = null;

function getSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY manquantes dans les variables d\'environnement');
    }
    // Chargé ici plutôt qu'en tête de fichier : les tests remplacent le client
    // et n'ont pas besoin que la dépendance soit installée.
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

/** Remplace le client (tests et serveur de développement local). */
function setSupabaseClient(replacement) {
  client = replacement;
}

module.exports = { getSupabase, setSupabaseClient };
