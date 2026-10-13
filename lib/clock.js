// Horloge du serveur, remplaçable dans les tests.

let override = null;

function now() {
  return override ? new Date(override.getTime()) : new Date();
}

/** Fige l'heure (tests). Appeler sans argument pour revenir à l'heure réelle. */
function setNow(date) {
  override = date ? new Date(date) : null;
}

module.exports = { now, setNow };
