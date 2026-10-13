const { getConfig } = require('../lib/config');
const { getPhaseForDate, getTodayISO, toLocalISODate, addDaysISO, dateFromISO } = require('../lib/cycle');
const { getRow } = require('../lib/store');
const { requireAccessCode } = require('../lib/auth');
const { serverError, methodNotAllowed } = require('../lib/http');
const { now } = require('../lib/clock');

const MAX_DAYS = 365; // garde-fou pour éviter une réponse démesurée après des années d'usage

module.exports = async function handler(req, res) {
  if (!requireAccessCode(req, res)) return;

  if (req.method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  try {
    const config = getConfig();
    const row = await getRow();
    if (!row) {
      res.status(200).json({ onboarded: false, days: [] });
      return;
    }

    const missed = new Set(row.missed_dates || []);
    const todayISO = getTodayISO(config, now());

    // On ne remonte jamais avant la création réelle du suivi : pas
    // d'historique fantaisiste antérieur à l'installation de l'app.
    const createdISO = row.created_at ? toLocalISODate(new Date(row.created_at), config) : todayISO;
    const daysSinceCreation =
      Math.round((dateFromISO(todayISO) - dateFromISO(createdISO)) / 86400000) + 1;

    const daysParam = parseInt((req.query || {}).days, 10);
    const requested = Number.isFinite(daysParam) ? Math.max(daysParam, 1) : MAX_DAYS;
    const numDays = Math.max(1, Math.min(requested, daysSinceCreation, MAX_DAYS));

    const days = [];
    for (let i = numDays - 1; i >= 0; i--) {
      const dateISO = addDaysISO(todayISO, -i);
      const info = getPhaseForDate(row.pack_start_date, row.pack_number_in_box, dateISO, config);
      days.push({
        date: dateISO,
        phase: info.phase,
        packNumberInBox: info.packNumberInBox,
        missed: missed.has(dateISO),
        isToday: dateISO === todayISO,
      });
    }

    res.status(200).json({ onboarded: true, days, startDate: createdISO });
  } catch (err) {
    serverError(res, 'history', err);
  }
};
