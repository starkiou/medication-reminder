const { getConfig } = require('../lib/config');
const { isValidISODate } = require('../lib/cycle');
const { upsertRow } = require('../lib/store');
const { requireAccessCode } = require('../lib/auth');
const { serverError, methodNotAllowed } = require('../lib/http');

/** Un abonnement Web Push valide désigne un service de push en HTTPS. */
function isValidSubscription(subscription) {
  return (
    !!subscription &&
    typeof subscription === 'object' &&
    typeof subscription.endpoint === 'string' &&
    subscription.endpoint.startsWith('https://')
  );
}

module.exports = async function handler(req, res) {
  if (!requireAccessCode(req, res)) return;

  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  try {
    const config = getConfig();
    const { subscription, packStartDate, packNumberInBox } = req.body || {};

    if (!isValidSubscription(subscription)) {
      res.status(400).json({ error: 'subscription invalide' });
      return;
    }
    if (!isValidISODate(packStartDate)) {
      res.status(400).json({ error: 'packStartDate doit être une date au format AAAA-MM-JJ' });
      return;
    }
    if (!Number.isInteger(packNumberInBox) || packNumberInBox < 1 || packNumberInBox > config.packsPerBox) {
      res.status(400).json({ error: `packNumberInBox doit être un entier entre 1 et ${config.packsPerBox}` });
      return;
    }

    await upsertRow({
      pack_start_date: packStartDate,
      pack_number_in_box: packNumberInBox,
      push_subscription: subscription,
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    serverError(res, 'subscribe', err);
  }
};
