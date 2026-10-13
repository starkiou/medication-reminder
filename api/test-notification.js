const { getConfig } = require('../lib/config');
const { computeState, getNotificationMessage, getBackupMessage, getTodayISO } = require('../lib/cycle');
const { getRow } = require('../lib/store');
const { sendPush } = require('../lib/push');
const { requireCronSecret } = require('../lib/auth');
const { serverError } = require('../lib/http');
const { now } = require('../lib/clock');

// Endpoint de TEST : envoie la notification tout de suite, sans vérifier
// l'heure. Protégé par CRON_SECRET, envoyé dans l'en-tête Authorization (et non
// dans l'URL, qui finit dans les journaux et l'historique du navigateur) :
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/test-notification
// Ajouter ?backup=1 pour recevoir le rappel de secours.
module.exports = async function handler(req, res) {
  if (!requireCronSecret(req, res)) return;

  try {
    const config = getConfig();
    const row = await getRow();
    if (!row) {
      res.status(200).json({ skipped: true, reason: "le suivi n'est pas encore configuré" });
      return;
    }
    if (!row.push_subscription) {
      res.status(200).json({ skipped: true, reason: "pas d'abonnement push" });
      return;
    }

    const state = computeState(row.pack_start_date, row.pack_number_in_box, getTodayISO(config, now()), config);
    const message = (req.query || {}).backup ? getBackupMessage(config) : getNotificationMessage(state, config);

    const delivered = await sendPush(row.push_subscription, message);
    res.status(200).json({ ok: true, delivered, sent: message });
  } catch (err) {
    serverError(res, 'test-notification', err);
  }
};
