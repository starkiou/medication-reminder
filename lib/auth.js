// Contrôle d'accès des endpoints.
//
// - L'application envoie un code d'accès (ACCESS_CODE) dans l'en-tête
//   X-Access-Code : sans lui, personne ne peut lire l'historique, modifier le
//   cycle ou remplacer l'abonnement aux notifications.
// - Le service de cron envoie CRON_SECRET dans l'en-tête Authorization.
//
// Les deux secrets sont obligatoires : s'ils ne sont pas configurés, les
// endpoints refusent de répondre plutôt que de rester ouverts.

const crypto = require('crypto');

/** Comparaison en temps constant, pour ne rien révéler par le temps de réponse. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function check(res, expected, provided, envName) {
  if (!expected) {
    console.error(`${envName} n'est pas définie : accès refusé`);
    res.status(503).json({ error: 'Application non configurée' });
    return false;
  }
  if (!safeEqual(provided, expected)) {
    res.status(401).json({ error: 'Non autorisé' });
    return false;
  }
  return true;
}

/** Vrai si la requête vient de l'application, munie du bon code d'accès. */
function requireAccessCode(req, res) {
  return check(res, process.env.ACCESS_CODE, req.headers['x-access-code'], 'ACCESS_CODE');
}

/** Vrai si la requête vient du service de cron. */
function requireCronSecret(req, res) {
  const header = req.headers['authorization'] || '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  return check(res, process.env.CRON_SECRET, provided, 'CRON_SECRET');
}

module.exports = { requireAccessCode, requireCronSecret, safeEqual };
