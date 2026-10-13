const { getConfig, publicConfig } = require('../lib/config');
const {
  computeState,
  buildCycleDays,
  getTodayISO,
  addDaysISO,
  isValidISODate,
  toLocalISODate,
  getPhaseForDate,
} = require('../lib/cycle');
const { getRow, updateRow } = require('../lib/store');
const { requireAccessCode } = require('../lib/auth');
const { serverError, methodNotAllowed } = require('../lib/http');
const { now } = require('../lib/clock');

const ACTIONS = ['mark_forgot_yesterday', 'confirm_taken_today', 'update_pack_start', 'set_day_status'];
const DAY_STATUSES = ['taken', 'missed', 'unknown'];

/** Ajoute une date à une liste sans doublon. */
function withDate(dates, iso) {
  return Array.from(new Set([...(dates || []), iso]));
}

function withoutDate(dates, iso) {
  return (dates || []).filter((d) => d !== iso);
}

/**
 * Listes à enregistrer pour qu'une journée soit prise, oubliée ou sans
 * information. Une même journée n'est jamais à la fois prise et oubliée.
 */
function dayStatusFields(row, iso, status) {
  return {
    confirmed_dates: status === 'taken' ? withDate(row.confirmed_dates, iso) : withoutDate(row.confirmed_dates, iso),
    missed_dates: status === 'missed' ? withDate(row.missed_dates, iso) : withoutDate(row.missed_dates, iso),
  };
}

module.exports = async function handler(req, res) {
  if (!requireAccessCode(req, res)) return;

  try {
    const config = getConfig();
    const todayISO = getTodayISO(config, now());

    if (req.method === 'GET') {
      const row = await getRow();
      if (!row) {
        res.status(200).json({ onboarded: false, config: publicConfig(config) });
        return;
      }

      const state = computeState(row.pack_start_date, row.pack_number_in_box, todayISO, config);
      const days = buildCycleDays(state.effectivePackStartDate, state.cycleDay, config);

      res.status(200).json({
        onboarded: true,
        ...state,
        missedDates: row.missed_dates || [],
        confirmedToday: (row.confirmed_dates || []).includes(todayISO),
        hasPushSubscription: !!row.push_subscription,
        days,
        config: publicConfig(config),
      });
      return;
    }

    if (req.method === 'POST') {
      const { action, packStartDate, packNumberInBox, date, status } = req.body || {};

      if (!ACTIONS.includes(action)) {
        res.status(400).json({ error: 'action inconnue' });
        return;
      }

      const row = await getRow();
      if (!row) {
        // Sans cette vérification, la mise à jour d'une ligne absente passait pour un succès
        res.status(409).json({ error: "Le suivi n'est pas encore configuré" });
        return;
      }

      if (action === 'mark_forgot_yesterday') {
        await updateRow(dayStatusFields(row, addDaysISO(todayISO, -1), 'missed'));
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'confirm_taken_today') {
        await updateRow(dayStatusFields(row, todayISO, 'taken'));
        res.status(200).json({ ok: true });
        return;
      }

      // Correction d'une journée depuis l'historique
      if (action === 'set_day_status') {
        if (!isValidISODate(date) || !DAY_STATUSES.includes(status)) {
          res.status(400).json({ error: 'date (AAAA-MM-JJ) et status (taken, missed ou unknown) requis' });
          return;
        }
        const createdISO = row.created_at ? toLocalISODate(new Date(row.created_at), config) : todayISO;
        if (date > todayISO || date < createdISO) {
          res.status(400).json({ error: 'La date doit être comprise entre le début du suivi et aujourd\'hui' });
          return;
        }
        if (getPhaseForDate(row.pack_start_date, row.pack_number_in_box, date, config).phase !== 'pill') {
          res.status(400).json({ error: 'Pas de prise prévue ce jour-là (jour de pause)' });
          return;
        }
        await updateRow(dayStatusFields(row, date, status));
        res.status(200).json({ ok: true });
        return;
      }

      // update_pack_start
      if (!isValidISODate(packStartDate)) {
        res.status(400).json({ error: 'packStartDate doit être une date au format AAAA-MM-JJ' });
        return;
      }
      if (!Number.isInteger(packNumberInBox) || packNumberInBox < 1 || packNumberInBox > config.packsPerBox) {
        res.status(400).json({ error: `packNumberInBox doit être un entier entre 1 et ${config.packsPerBox}` });
        return;
      }
      await updateRow({ pack_start_date: packStartDate, pack_number_in_box: packNumberInBox });
      res.status(200).json({ ok: true });
      return;
    }

    methodNotAllowed(res);
  } catch (err) {
    serverError(res, 'state', err);
  }
};
