const { getConfig } = require('../lib/config');
const { computeState, getNotificationMessage, getTodayISO, isReminderWindow } = require('../lib/cycle');
const { getRow, updateRow } = require('../lib/store');
const { sendPush } = require('../lib/push');
const { requireCronSecret } = require('../lib/auth');
const { serverError } = require('../lib/http');
const { now } = require('../lib/clock');

// Rappel quotidien. Appelé par un service de cron externe (cron-job.org) :
// le cron intégré de Vercel n'est pas assez précis sur l'offre gratuite.
// L'heure est vérifiée ici, dans le fuseau configuré, ce qui permet de
// programmer le cron sans se soucier de l'heure d'été.
module.exports = async function handler(req, res) {
  if (!requireCronSecret(req, res)) return;

  try {
    const config = getConfig();
    const current = now();

    if (!isReminderWindow(config.reminderHour, config, current)) {
      res.status(200).json({ skipped: true, reason: "hors de l'heure du rappel" });
      return;
    }

    const row = await getRow();
    if (!row || !row.push_subscription) {
      res.status(200).json({ skipped: true, reason: "pas d'abonnement push" });
      return;
    }

    const todayISO = getTodayISO(config, current);
    const state = computeState(row.pack_start_date, row.pack_number_in_box, todayISO, config);

    // Si le cycle a avancé (nouvelle plaquette / nouvelle boîte), on
    // réécrit les valeurs en base pour que le prochain calcul reparte propre.
    if (
      state.effectivePackStartDate !== row.pack_start_date ||
      state.effectivePackNumberInBox !== row.pack_number_in_box
    ) {
      await updateRow({
        pack_start_date: state.effectivePackStartDate,
        pack_number_in_box: state.effectivePackNumberInBox,
      });
    }

    // Prise déjà confirmée aujourd'hui : inutile de relancer.
    if (state.phase === 'pill' && (row.confirmed_dates || []).includes(todayISO)) {
      res.status(200).json({ skipped: true, reason: "déjà confirmé aujourd'hui" });
      return;
    }

    const delivered = await sendPush(row.push_subscription, getNotificationMessage(state, config));
    res.status(200).json({ ok: true, delivered });
  } catch (err) {
    serverError(res, 'cron', err);
  }
};
