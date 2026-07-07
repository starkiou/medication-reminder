const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const { subscription, packStartDate, packNumberInBox } = req.body || {};

    if (!subscription || !packStartDate || !packNumberInBox) {
      res.status(400).json({ error: 'subscription, packStartDate et packNumberInBox sont requis' });
      return;
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from('app_state')
      .upsert({
        id: 1,
        pack_start_date: packStartDate,
        pack_number_in_box: packNumberInBox,
        push_subscription: subscription,
        updated_at: new Date().toISOString(),
      });

    if (error) throw error;

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe error', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
