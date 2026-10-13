const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig, publicConfig } = require('../lib/config');

test('sans variable, le cycle est 21/7 avec rappels à 21h et 22h, heure de Paris', () => {
  const c = loadConfig({});
  assert.equal(c.pillDays, 21);
  assert.equal(c.pauseDays, 7);
  assert.equal(c.cycleLength, 28);
  assert.equal(c.packsPerBox, 3);
  assert.equal(c.reminderHour, 21);
  assert.equal(c.backupHour, 22);
  assert.equal(c.timezone, 'Europe/Paris');
  assert.equal(c.medName, null);
  assert.deepEqual(c.medDetails, []);
  assert.equal(c.yours, 'ton traitement');
  assert.equal(c.mine, 'mon traitement');
  assert.equal(c.the, 'le traitement');
});

test('les variables remplacent les valeurs par défaut', () => {
  const c = loadConfig({
    PILL_DAYS: '24',
    PAUSE_DAYS: '4',
    PACKS_PER_BOX: '1',
    REMINDER_HOUR: '8',
    BACKUP_HOUR: 'off',
    TIMEZONE: 'America/Montreal',
    MED_NAME: 'Exemplix',
    MED_DETAILS: 'Dosage 1 mg | 1 plaquette de 24 comprimés',
    MED_NOUN: 'pilule',
    MED_NOUN_FEMININE: 'true',
  });
  assert.equal(c.cycleLength, 28);
  assert.equal(c.reminderHour, 8);
  assert.equal(c.backupHour, null);
  assert.equal(c.timezone, 'America/Montreal');
  assert.equal(c.medName, 'Exemplix');
  assert.deepEqual(c.medDetails, ['Dosage 1 mg', '1 plaquette de 24 comprimés']);
  assert.equal(c.yours, 'ta pilule');
  assert.equal(c.mine, 'ma pilule');
  assert.equal(c.the, 'la pilule');
});

test('une valeur invalide arrête le démarrage au lieu d\'être ignorée', () => {
  assert.throws(() => loadConfig({ PILL_DAYS: '0' }), /PILL_DAYS/);
  assert.throws(() => loadConfig({ PILL_DAYS: 'vingt' }), /PILL_DAYS/);
  assert.throws(() => loadConfig({ PAUSE_DAYS: '-1' }), /PAUSE_DAYS/);
  assert.throws(() => loadConfig({ REMINDER_HOUR: '24' }), /REMINDER_HOUR/);
  assert.throws(() => loadConfig({ REMINDER_HOUR: '21.5' }), /REMINDER_HOUR/);
  assert.throws(() => loadConfig({ TIMEZONE: 'Mars/Olympus' }), /TIMEZONE/);
});

test('la configuration envoyée à l\'interface ne contient pas le fuseau ni de secret', () => {
  const shared = publicConfig(loadConfig({ MED_NAME: 'Exemplix' }));
  assert.equal(shared.medName, 'Exemplix');
  assert.equal(shared.cycleLength, 28);
  assert.equal('timezone' in shared, false);
  assert.deepEqual(
    Object.keys(shared).sort(),
    ['backupHour', 'cycleLength', 'medDetails', 'medName', 'mine', 'packsPerBox', 'pauseDays', 'pillDays', 'reminderHour', 'the', 'yours']
  );
});
