// Envoi d'une notification push à l'abonnement enregistré.

const { updateRow } = require('./store');

let sender = null;

function getSender() {
  if (!sender) {
    const webpush = require('web-push');
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:contact@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
    sender = (subscription, payload) => webpush.sendNotification(subscription, payload);
  }
  return sender;
}

/** Remplace l'envoi réel (tests et serveur de développement local). */
function setPushSender(replacement) {
  sender = replacement;
}

/**
 * Envoie `message` ({ title, body }). Renvoie false si l'abonnement n'est
 * plus valide : il est alors retiré de la base, et l'application redemandera
 * l'autorisation à la prochaine ouverture.
 */
async function sendPush(subscription, message) {
  try {
    await getSender()(subscription, JSON.stringify(message));
    return true;
  } catch (err) {
    // 404/410 = l'abonnement n'existe plus (app désinstallée, permission retirée...)
    if (err.statusCode === 404 || err.statusCode === 410) {
      await updateRow({ push_subscription: null });
      return false;
    }
    throw err;
  }
}

module.exports = { sendPush, setPushSender };
