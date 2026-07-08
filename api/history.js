const { getSupabase } = require('../lib/supabase');
const { getPhaseForDate, toISODate } = require('../lib/cycle');

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return toISODate(date);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Méthode non autorisée' });
    return;
  }

  try {
    const supabase = getSupabase();
    const { data: row, error } = await supabase
      .from('app_state')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;
    if (!row) {
      res.status(200).json({ onboarded: false, days: [] });
      return;
    }

    const missed = new Set(row.missed_dates || []);
    const todayISO = toISODate(new Date());

    // On ne remonte jamais avant la création réelle du compte : pas
    // d'historique fantaisiste antérieur à l'installation de l'app.
    const createdISO = row.created_at ? toISODate(new Date(row.created_at)) : todayISO;
    const daysSinceCreation =
      Math.round((new Date(todayISO) - new Date(createdISO)) / 86400000) + 1;

    const daysParam = parseInt(req.query.days, 10);
    const requested = Number.isFinite(daysParam) ? Math.max(daysParam, 1) : 365;
    const MAX_DAYS = 365; // garde-fou pour éviter une réponse démesurée après des années d'usage
    const numDays = Math.min(requested, daysSinceCreation, MAX_DAYS);

    const days = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const dateISO = addDaysISO(todayISO, -i);
      const info = getPhaseForDate(row.pack_start_date, row.pack_number_in_box, dateISO);
      days.push({
        date: dateISO,
        phase: info.phase,
        packNumberInBox: info.packNumberInBox,
        missed: missed.has(dateISO),
        isFuture: dateISO > todayISO,
        isToday: dateISO === todayISO,
      });
    }

    res.status(200).json({ onboarded: true, days, startDate: createdISO });
  } catch (err) {
    console.error('history error', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
