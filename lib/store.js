// Accès à la ligne unique de la table app_state : l'application suit une
// seule personne, donc une seule ligne (id = 1).

const { getSupabase } = require('./supabase');

const ROW_ID = 1;

async function getRow() {
  const { data, error } = await getSupabase()
    .from('app_state')
    .select('*')
    .eq('id', ROW_ID)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateRow(fields) {
  const { error } = await getSupabase()
    .from('app_state')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', ROW_ID);
  if (error) throw error;
}

async function upsertRow(fields) {
  const { error } = await getSupabase()
    .from('app_state')
    .upsert({ id: ROW_ID, ...fields, updated_at: new Date().toISOString() });
  if (error) throw error;
}

module.exports = { getRow, updateRow, upsertRow };
