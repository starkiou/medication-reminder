/**
 * Répond 500 sans exposer le détail de l'erreur : il part dans les journaux
 * du serveur, pas chez le client.
 */
function serverError(res, label, err) {
  console.error(`${label} error`, err);
  res.status(500).json({ error: 'Erreur serveur' });
}

function methodNotAllowed(res) {
  res.status(405).json({ error: 'Méthode non autorisée' });
}

module.exports = { serverError, methodNotAllowed };
