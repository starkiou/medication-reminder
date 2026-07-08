// Logique du cycle : 21 jours de prise, 7 jours de pause,
// 3 plaquettes par boîte (63 comprimés).

const PILL_DAYS = 21;
const PAUSE_DAYS = 7;
const CYCLE_LENGTH = PILL_DAYS + PAUSE_DAYS; // 28
const PACKS_PER_BOX = 3;

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function dateFromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/**
 * Calcule l'état du cycle à une date donnée, en faisant avancer
 * automatiquement pack_start_date / pack_number_in_box si un ou
 * plusieurs cycles de 28 jours se sont écoulés depuis la dernière
 * mise à jour stockée en base.
 */
function computeState(packStartDateISO, packNumberInBox, referenceDate = new Date()) {
  let start = dateFromISO(packStartDateISO);
  const today = dateFromISO(toISODate(referenceDate));
  let packNum = packNumberInBox;

  let diffDays = Math.round((today - start) / 86400000);

  // Fait avancer le cycle si un ou plusieurs cycles complets sont passés
  // (protège contre le cas où le cron n'aurait pas tourné pendant un moment)
  while (diffDays >= CYCLE_LENGTH) {
    diffDays -= CYCLE_LENGTH;
    packNum = packNum >= PACKS_PER_BOX ? 1 : packNum + 1;
    start = addDays(start, CYCLE_LENGTH);
  }

  const cycleDay = diffDays + 1; // 1-indexé
  const phase = cycleDay <= PILL_DAYS ? 'pill' : 'pause';
  const pillsRemainingInPack = phase === 'pill' ? PILL_DAYS - cycleDay + 1 : 0;
  const pauseDayNumber = phase === 'pause' ? cycleDay - PILL_DAYS : null;
  const needsNewBox = packNum === PACKS_PER_BOX && phase === 'pause';

  return {
    cycleDay,
    phase, // 'pill' | 'pause'
    pauseDayNumber, // 1..7 pendant la pause
    packNumberInBox: packNum, // 1, 2 ou 3
    pillsRemainingInPack,
    needsNewBox,
    // valeurs à réécrire en base pour que le prochain calcul reparte propre
    effectivePackStartDate: toISODate(start),
    effectivePackNumberInBox: packNum,
  };
}

/** Modulo qui reste positif même pour des diviseurs négatifs (contrairement à %). */
function positiveMod(n, m) {
  return ((n % m) + m) % m;
}

/**
 * Calcule la phase (prise/pause) et le numéro de plaquette à une date
 * quelconque, passée ou future, à partir d'une date-ancre qui correspond
 * toujours à un jour 1 de plaquette. Le cycle étant parfaitement
 * périodique, ça marche sans avoir besoin de faire avancer l'ancre.
 * Sert à construire l'historique (jours déjà passés).
 */
function getPhaseForDate(anchorPackStartDateISO, anchorPackNumberInBox, targetDateISO) {
  const anchor = dateFromISO(anchorPackStartDateISO);
  const target = dateFromISO(targetDateISO);

  const rawDiff = Math.round((target - anchor) / 86400000);
  const cycleDay = positiveMod(rawDiff, CYCLE_LENGTH) + 1; // 1..28
  const cyclesFromAnchor = Math.floor(rawDiff / CYCLE_LENGTH);
  const packNumberInBox = positiveMod(anchorPackNumberInBox - 1 + cyclesFromAnchor, PACKS_PER_BOX) + 1;
  const phase = cycleDay <= PILL_DAYS ? 'pill' : 'pause';

  return { cycleDay, phase, packNumberInBox };
}


function getNotificationMessage(state) {
  if (state.phase === 'pill') {
    return {
      title: 'Pilule 💊',
      body: `Jour ${state.cycleDay}/21 — prends ta pilule`,
    };
  }
  let body = `Jour de pause ${state.pauseDayNumber}/7 — pas de pilule aujourd'hui`;
  if (state.needsNewBox) {
    body += '. Pense à racheter une boîte avant la reprise !';
  }
  return { title: 'Pause', body };
}

/** Construit les 28 jours du cycle courant pour l'affichage du calendrier. */
function buildCycleDays(effectivePackStartDateISO, cycleDay) {
  const start = dateFromISO(effectivePackStartDateISO);
  const days = [];
  for (let i = 0; i < CYCLE_LENGTH; i++) {
    const dayNumber = i + 1;
    days.push({
      dayNumber,
      date: toISODate(addDays(start, i)),
      phase: dayNumber <= PILL_DAYS ? 'pill' : 'pause',
      status: dayNumber < cycleDay ? 'past' : dayNumber === cycleDay ? 'today' : 'future',
    });
  }
  return days;
}

module.exports = {
  PILL_DAYS,
  PAUSE_DAYS,
  CYCLE_LENGTH,
  PACKS_PER_BOX,
  toISODate,
  dateFromISO,
  computeState,
  getNotificationMessage,
  buildCycleDays,
  getPhaseForDate,
};
