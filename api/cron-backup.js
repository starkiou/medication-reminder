const { getConfig } = require('../lib/config');
const { computeState, getBackupMessage, getTodayISO, isReminderWindow } = require('../lib/cycle');
const { getRow } = require('../lib/store');
const { sendPush } = require('../lib/push');
const { requireCronSecret } = require('../lib/auth');
const { serverError } = require('../lib/http');
const { now } = require('../lib/clock');

// Rappel de secours : une heure après le rappel principal, seulement si la
// prise du jour n'a pas été confirmée dans l'application.
module.exports = async function handler(req, res) {
  if (!requireCronSecret(req, res)) return;

  try {
    const config = getConfig();
    const current = now();

    if (config.backupHour === null) {
      res.status(200).json({ skipped: true, reason: 'rappel de secours désactivé' });
      return;
    }
    if (!isReminderWindow(config.backupHour, config, current)) {
      res.status(200).json({ skipped: true, reason: "hors de l'heure du rappel de secours" });
      return;
    }

    const row = await getRow();
    if (!row || !row.push_subscription) {
      res.status(200).json({ skipped: true, reason: "pas d'abonnement push" });
      return;
    }

    const todayISO = getTodayISO(config, current);
    const state = computeState(row.pack_start_date, row.pack_number_in_box, todayISO, config);

    // Pas de rappel de secours pendant la pause : rien à confirmer ces jours-là.
    if (state.phase !== 'pill') {
      res.status(200).json({ skipped: true, reason: 'jour de pause, pas de rappel de secours' });
      return;
    }
    if ((row.confirmed_dates || []).includes(todayISO)) {
      res.status(200).json({ skipped: true, reason: "déjà confirmé aujourd'hui" });
      return;
    }

    const delivered = await sendPush(row.push_subscription, getBackupMessage(config));
    res.status(200).json({ ok: true, delivered });
  } catch (err) {
    serverError(res, 'cron-backup', err);
  }
};
