// Réglages du suivi, lus dans les variables d'environnement.
// Sans aucune variable, on obtient un cycle 21 jours de prise / 7 jours de
// pause, 3 plaquettes par boîte, rappel à 21h et rappel de secours à 22h.

function intEnv(env, name, fallback, min, max) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} doit être un entier entre ${min} et ${max} (reçu : "${raw}")`);
  }
  return value;
}

function checkTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: timezone });
  } catch (e) {
    throw new Error(`TIMEZONE invalide : "${timezone}"`);
  }
  return timezone;
}

function loadConfig(env = process.env) {
  const pillDays = intEnv(env, 'PILL_DAYS', 21, 1, 365);
  const pauseDays = intEnv(env, 'PAUSE_DAYS', 7, 0, 365);
  const packsPerBox = intEnv(env, 'PACKS_PER_BOX', 3, 1, 12);
  const reminderHour = intEnv(env, 'REMINDER_HOUR', 21, 0, 23);
  // BACKUP_HOUR=off désactive le rappel de secours
  const backupHour = env.BACKUP_HOUR === 'off' ? null : intEnv(env, 'BACKUP_HOUR', 22, 0, 23);

  // Le nom commun sert à construire les phrases : « prends ta pilule »,
  // « j'ai pris mon traitement »...
  const noun = env.MED_NOUN || 'traitement';
  const feminine = env.MED_NOUN_FEMININE === 'true';

  return {
    pillDays,
    pauseDays,
    cycleLength: pillDays + pauseDays,
    packsPerBox,
    reminderHour,
    backupHour,
    timezone: checkTimezone(env.TIMEZONE || 'Europe/Paris'),
    // Nom du médicament : absent par défaut, il n'apparaît alors ni dans
    // l'interface ni dans les notifications.
    medName: env.MED_NAME || null,
    // Lignes de détail affichées sous le nom, séparées par « | »
    medDetails: (env.MED_DETAILS || '').split('|').map((s) => s.trim()).filter(Boolean),
    noun,
    yours: `${feminine ? 'ta' : 'ton'} ${noun}`,
    mine: `${feminine ? 'ma' : 'mon'} ${noun}`,
    the: `${feminine ? 'la' : 'le'} ${noun}`,
  };
}

let cached = null;

function getConfig() {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Ce que l'interface a besoin de connaître des réglages. */
function publicConfig(config = getConfig()) {
  return {
    medName: config.medName,
    medDetails: config.medDetails,
    pillDays: config.pillDays,
    pauseDays: config.pauseDays,
    cycleLength: config.cycleLength,
    packsPerBox: config.packsPerBox,
    reminderHour: config.reminderHour,
    backupHour: config.backupHour,
    yours: config.yours,
    mine: config.mine,
    the: config.the,
  };
}

module.exports = { loadConfig, getConfig, publicConfig };
