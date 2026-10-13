// Logique du cycle : N jours de prise, M jours de pause, P plaquettes par
// boîte. Les durées viennent de lib/config.js ; toutes les fonctions prennent
// la configuration en paramètre pour pouvoir être testées avec d'autres cycles.

const { getConfig } = require('./config');

const DAY_MS = 86400000;

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

function addDaysISO(iso, days) {
  return toISODate(addDays(dateFromISO(iso), days));
}

/** Vrai si la chaîne est une date calendaire réelle au format YYYY-MM-DD. */
function isValidISODate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toISODate(dateFromISO(iso)) === iso;
}

/**
 * Convertit une date/heure en date calendaire (YYYY-MM-DD) telle qu'elle est
 * affichée dans le fuseau configuré, plutôt qu'en UTC.
 */
function toLocalISODate(date, config = getConfig()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function getTodayISO(config = getConfig(), now = new Date()) {
  return toLocalISODate(now, config);
}

/** Heure et minute locales, dans le fuseau configuré (gère l'heure d'été). */
function getLocalTime(config = getConfig(), now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parseInt(parts.find((p) => p.type === type).value, 10);
  return { hour: get('hour'), minute: get('minute') };
}

/**
 * Vrai si on est dans la fenêtre d'envoi du rappel de `targetHour` : pendant
 * toute l'heure visée, ou dans les cinq minutes qui la précèdent. Un service
 * de cron externe peut partir quelques secondes trop tôt ; sans cette marge,
 * l'appel de 20:59:58 était ignoré et aucun rappel ne partait ce soir-là.
 */
function isReminderWindow(targetHour, config = getConfig(), now = new Date()) {
  const { hour, minute } = getLocalTime(config, now);
  if (hour === targetHour) return true;
  const previousHour = (targetHour + 23) % 24;
  return hour === previousHour && minute >= 55;
}

/**
 * Calcule l'état du cycle à une date donnée, en faisant avancer
 * automatiquement la date de début de plaquette et son numéro si un ou
 * plusieurs cycles complets se sont écoulés depuis la dernière mise à jour
 * stockée en base.
 */
function computeState(packStartDateISO, packNumberInBox, todayISO = getTodayISO(), config = getConfig()) {
  let start = dateFromISO(packStartDateISO);
  const today = dateFromISO(todayISO);
  let packNum = packNumberInBox;

  let diffDays = Math.round((today - start) / DAY_MS);

  // Fait avancer le cycle si un ou plusieurs cycles complets sont passés
  // (protège contre le cas où le cron n'aurait pas tourné pendant un moment)
  while (diffDays >= config.cycleLength) {
    diffDays -= config.cycleLength;
    packNum = packNum >= config.packsPerBox ? 1 : packNum + 1;
    start = addDays(start, config.cycleLength);
  }

  const cycleDay = diffDays + 1; // 1-indexé
  const phase = cycleDay <= config.pillDays ? 'pill' : 'pause';
  const pillsRemainingInPack = phase === 'pill' ? config.pillDays - cycleDay + 1 : 0;
  const pauseDayNumber = phase === 'pause' ? cycleDay - config.pillDays : null;
  const needsNewBox = packNum === config.packsPerBox && phase === 'pause';
  const nextPackStartDate = toISODate(addDays(start, config.cycleLength));
  const daysUntilResume = phase === 'pause' ? config.cycleLength + 1 - cycleDay : null; // 1 = reprise demain

  return {
    cycleDay,
    phase, // 'pill' | 'pause'
    pauseDayNumber, // 1..pauseDays pendant la pause
    packNumberInBox: packNum,
    pillsRemainingInPack,
    needsNewBox,
    nextPackStartDate, // date de reprise (jour 1 de la prochaine plaquette)
    daysUntilResume, // nombre de jours avant la reprise, seulement pendant la pause
    // valeurs à réécrire en base pour que le prochain calcul reparte propre
    effectivePackStartDate: toISODate(start),
    effectivePackNumberInBox: packNum,
  };
}

/** Modulo qui reste positif même pour des dividendes négatifs (contrairement à %). */
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
function getPhaseForDate(anchorPackStartDateISO, anchorPackNumberInBox, targetDateISO, config = getConfig()) {
  const anchor = dateFromISO(anchorPackStartDateISO);
  const target = dateFromISO(targetDateISO);

  const rawDiff = Math.round((target - anchor) / DAY_MS);
  const cycleDay = positiveMod(rawDiff, config.cycleLength) + 1;
  const cyclesFromAnchor = Math.floor(rawDiff / config.cycleLength);
  const packNumberInBox = positiveMod(anchorPackNumberInBox - 1 + cyclesFromAnchor, config.packsPerBox) + 1;
  const phase = cycleDay <= config.pillDays ? 'pill' : 'pause';

  return { cycleDay, phase, packNumberInBox };
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function getNotificationMessage(state, config = getConfig()) {
  // Le nom du médicament n'est ajouté que s'il a été configuré
  const what = config.medName ? `${config.yours} ${config.medName}` : config.yours;

  if (state.phase === 'pill') {
    if (state.cycleDay === 1) {
      return {
        title: 'Reprise 💊',
        body: `C'est le jour de reprise — prends ${what}`,
      };
    }
    return {
      title: `${capitalize(config.noun)} 💊`,
      body: `Jour ${state.cycleDay}/${config.pillDays} — prends ${what}`,
    };
  }
  if (state.daysUntilResume === 1) {
    let body = `Dernier jour de pause — tu reprends ${config.the} demain !`;
    if (state.needsNewBox) {
      body += ' Pense à racheter une boîte.';
    }
    return { title: 'Reprise demain', body };
  }
  let body = `Jour de pause ${state.pauseDayNumber}/${config.pauseDays} — pas de ${config.noun} aujourd'hui`;
  if (state.needsNewBox) {
    body += '. Pense à racheter une boîte avant la reprise !';
  }
  return { title: 'Pause', body };
}

function getBackupMessage(config = getConfig()) {
  return {
    title: 'Rappel de secours 🌸',
    body: `Tu n'as pas encore confirmé avoir pris ${config.yours} ce soir — n'oublie pas !`,
  };
}

/** Construit les jours du cycle courant pour l'affichage de l'anneau. */
function buildCycleDays(effectivePackStartDateISO, cycleDay, config = getConfig()) {
  const start = dateFromISO(effectivePackStartDateISO);
  const days = [];
  for (let i = 0; i < config.cycleLength; i++) {
    const dayNumber = i + 1;
    days.push({
      dayNumber,
      date: toISODate(addDays(start, i)),
      phase: dayNumber <= config.pillDays ? 'pill' : 'pause',
      status: dayNumber < cycleDay ? 'past' : dayNumber === cycleDay ? 'today' : 'future',
    });
  }
  return days;
}

module.exports = {
  toISODate,
  dateFromISO,
  addDaysISO,
  isValidISODate,
  toLocalISODate,
  getTodayISO,
  getLocalTime,
  isReminderWindow,
  computeState,
  getNotificationMessage,
  getBackupMessage,
  buildCycleDays,
  getPhaseForDate,
};
