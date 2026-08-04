const { getSupabase } = require('../lib/supabase');
const { computeState, buildCycleDays, getParisTodayISO, dateFromISO, toISODate } = require('../lib/cycle');

async function getRow(supabase) {
  const { data, error } = await supabase
    .from('app_state')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

module.exports = async function handler(req, res) {
  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const row = await getRow(supabase);
      if (!row) {
        res.status(200).json({ onboarded: false });
        return;
      }

      const state = computeState(row.pack_start_date, row.pack_number_in_box);
      const days = buildCycleDays(state.effectivePackStartDate, state.cycleDay);
      const todayISO = getParisTodayISO();

      res.status(200).json({
        onboarded: true,
        ...state,
        missedDates: row.missed_dates || [],
        confirmedToday: (row.confirmed_dates || []).includes(todayISO),
        hasPushSubscription: !!row.push_subscription,
        days,
      });
      return;
    }

    if (req.method === 'POST') {
      const { action, packStartDate, packNumberInBox } = req.body || {};

      if (action === 'mark_forgot_yesterday') {
        const row = await getRow(supabase);
        const todayISO = getParisTodayISO();
        const yesterday = toISODate(new Date(dateFromISO(todayISO).getTime() - 86400000));
        const missed = new Set(row?.missed_dates || []);
        missed.add(yesterday);
        const { error } = await supabase
          .from('app_state')
          .update({ missed_dates: Array.from(missed), updated_at: new Date().toISOString() })
          .eq('id', 1);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'confirm_taken_today') {
        const row = await getRow(supabase);
        const todayISO = getParisTodayISO();
        const confirmed = new Set(row?.confirmed_dates || []);
        confirmed.add(todayISO);
        const { error } = await supabase
          .from('app_state')
          .update({ confirmed_dates: Array.from(confirmed), updated_at: new Date().toISOString() })
          .eq('id', 1);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'update_pack_start') {
        if (!packStartDate || !packNumberInBox) {
          res.status(400).json({ error: 'packStartDate et packNumberInBox requis' });
          return;
        }
        const { error } = await supabase
          .from('app_state')
          .update({
            pack_start_date: packStartDate,
            pack_number_in_box: packNumberInBox,
            updated_at: new Date().toISOString(),
          })
          .eq('id', 1);
        if (error) throw error;
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'action inconnue' });
      return;
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (err) {
    console.error('state error', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
