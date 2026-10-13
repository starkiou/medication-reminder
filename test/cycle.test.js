const { test } = require('node:test');
const assert = require('node:assert/strict');

const { loadConfig } = require('../lib/config');
const {
  addDaysISO,
  isValidISODate,
  toLocalISODate,
  getTodayISO,
  isReminderWindow,
  computeState,
  getPhaseForDate,
  getNotificationMessage,
  getBackupMessage,
  buildCycleDays,
} = require('../lib/cycle');

// Cycle par défaut : 21 jours de prise, 7 de pause, 3 plaquettes par boîte
const cfg = loadConfig({});
const START = '2026-01-05';

const state = (today, pack = 1, config = cfg) => computeState(START, pack, today, config);

// ─── Déroulement d'une plaquette ─────────────────────────────────────────────

test('le premier jour est un jour de prise, plaquette pleine', () => {
  const s = state(START);
  assert.equal(s.cycleDay, 1);
  assert.equal(s.phase, 'pill');
  assert.equal(s.pillsRemainingInPack, 21);
  assert.equal(s.pauseDayNumber, null);
  assert.equal(s.daysUntilResume, null);
});

test('le 21e jour est le dernier comprimé', () => {
  const s = state(addDaysISO(START, 20));
  assert.equal(s.cycleDay, 21);
  assert.equal(s.phase, 'pill');
  assert.equal(s.pillsRemainingInPack, 1);
});

test('la pause commence le 22e jour et dure 7 jours', () => {
  const first = state(addDaysISO(START, 21));
  assert.equal(first.phase, 'pause');
  assert.equal(first.pauseDayNumber, 1);
  assert.equal(first.daysUntilResume, 7);
  assert.equal(first.pillsRemainingInPack, 0);

  const last = state(addDaysISO(START, 27));
  assert.equal(last.phase, 'pause');
  assert.equal(last.pauseDayNumber, 7);
  assert.equal(last.daysUntilResume, 1);
  assert.equal(last.nextPackStartDate, addDaysISO(START, 28));
});

// ─── Changement de plaquette et de boîte ─────────────────────────────────────

test('au 29e jour on passe à la plaquette suivante', () => {
  const s = state(addDaysISO(START, 28));
  assert.equal(s.cycleDay, 1);
  assert.equal(s.phase, 'pill');
  assert.equal(s.packNumberInBox, 2);
  assert.equal(s.effectivePackStartDate, addDaysISO(START, 28));
  assert.equal(s.effectivePackNumberInBox, 2);
});

test('après la 3e plaquette on revient à la plaquette 1 (nouvelle boîte)', () => {
  const s = state(addDaysISO(START, 28), 3);
  assert.equal(s.packNumberInBox, 1);
});

test('il faut racheter une boîte pendant la pause de la dernière plaquette seulement', () => {
  assert.equal(state(addDaysISO(START, 22), 3).needsNewBox, true);
  assert.equal(state(addDaysISO(START, 22), 2).needsNewBox, false);
  assert.equal(state(addDaysISO(START, 10), 3).needsNewBox, false);
});

test('plusieurs cycles manqués sont rattrapés d\'un coup', () => {
  // 100 jours plus tard : 3 cycles complets (84 jours) + 16 jours
  const s = state(addDaysISO(START, 100));
  assert.equal(s.cycleDay, 17);
  assert.equal(s.packNumberInBox, 1); // 1 -> 2 -> 3 -> 1
  assert.equal(s.effectivePackStartDate, addDaysISO(START, 84));
});

test('recalculer depuis les valeurs effectives donne le même état', () => {
  const today = addDaysISO(START, 150);
  const first = state(today, 2);
  const again = computeState(first.effectivePackStartDate, first.effectivePackNumberInBox, today, cfg);
  assert.deepEqual(again, first);
});

// ─── Historique : cohérence avec l'état courant ──────────────────────────────

test('getPhaseForDate et computeState sont d\'accord sur 200 jours', () => {
  for (let i = 0; i < 200; i++) {
    const day = addDaysISO(START, i);
    const s = state(day, 2);
    const p = getPhaseForDate(START, 2, day, cfg);
    assert.equal(p.cycleDay, s.cycleDay, `jour ${i}`);
    assert.equal(p.phase, s.phase, `jour ${i}`);
    assert.equal(p.packNumberInBox, s.packNumberInBox, `jour ${i}`);
  }
});

test('getPhaseForDate remonte avant la date de départ', () => {
  // La veille du départ est le dernier jour de pause de la plaquette précédente
  const eve = getPhaseForDate(START, 1, addDaysISO(START, -1), cfg);
  assert.equal(eve.cycleDay, 28);
  assert.equal(eve.phase, 'pause');
  assert.equal(eve.packNumberInBox, 3);

  const lastPill = getPhaseForDate(START, 1, addDaysISO(START, -8), cfg);
  assert.equal(lastPill.cycleDay, 21);
  assert.equal(lastPill.phase, 'pill');
});

test('buildCycleDays décrit les 28 jours du cycle courant', () => {
  const days = buildCycleDays(START, 22, cfg);
  assert.equal(days.length, 28);
  assert.equal(days[0].date, START);
  assert.equal(days[20].phase, 'pill');
  assert.equal(days[21].phase, 'pause');
  assert.equal(days[20].status, 'past');
  assert.equal(days[21].status, 'today');
  assert.equal(days[22].status, 'future');
});

// ─── Dates et fuseau horaire ─────────────────────────────────────────────────

test('addDaysISO passe les fins de mois et le 29 février', () => {
  assert.equal(addDaysISO('2026-01-31', 1), '2026-02-01');
  assert.equal(addDaysISO('2028-02-28', 1), '2028-02-29'); // année bissextile
  assert.equal(addDaysISO('2027-02-28', 1), '2027-03-01');
  assert.equal(addDaysISO('2026-03-01', -1), '2026-02-28');
});

test('isValidISODate refuse les dates impossibles et les autres formats', () => {
  assert.equal(isValidISODate('2026-02-28'), true);
  assert.equal(isValidISODate('2028-02-29'), true);
  assert.equal(isValidISODate('2026-02-30'), false);
  assert.equal(isValidISODate('2027-02-29'), false);
  assert.equal(isValidISODate('28/02/2026'), false);
  assert.equal(isValidISODate('2026-2-8'), false);
  assert.equal(isValidISODate(20260228), false);
  assert.equal(isValidISODate(null), false);
});

test('la date du jour est celle de Paris, pas celle d\'UTC', () => {
  // 23h30 à Paris en hiver (UTC+1) : encore le 14 à Paris, 22h30 UTC
  assert.equal(getTodayISO(cfg, new Date('2026-01-14T22:30:00Z')), '2026-01-14');
  // 00h30 à Paris en hiver : déjà le 15 à Paris alors qu'UTC est encore le 14
  assert.equal(getTodayISO(cfg, new Date('2026-01-14T23:30:00Z')), '2026-01-15');
  // 00h30 à Paris en été (UTC+2) : déjà le 15, UTC est à 22h30 le 14
  assert.equal(getTodayISO(cfg, new Date('2026-07-14T22:30:00Z')), '2026-07-15');
});

test('la date suit le fuseau configuré', () => {
  const tokyo = loadConfig({ TIMEZONE: 'Asia/Tokyo' });
  assert.equal(toLocalISODate(new Date('2026-01-14T16:00:00Z'), tokyo), '2026-01-15');
  assert.equal(toLocalISODate(new Date('2026-01-14T16:00:00Z'), cfg), '2026-01-14');
});

// ─── Fenêtre d'envoi du rappel ───────────────────────────────────────────────

test('le rappel de 21h part à 21h de Paris, été comme hiver', () => {
  assert.equal(isReminderWindow(21, cfg, new Date('2026-01-14T20:00:00Z')), true); // hiver : 21h = 20h UTC
  assert.equal(isReminderWindow(21, cfg, new Date('2026-07-14T19:00:00Z')), true); // été : 21h = 19h UTC
  assert.equal(isReminderWindow(21, cfg, new Date('2026-07-14T20:00:00Z')), false); // été : 22h à Paris
  assert.equal(isReminderWindow(21, cfg, new Date('2026-01-14T19:00:00Z')), false); // hiver : 20h à Paris
});

test('un cron parti quelques secondes trop tôt n\'est pas ignoré', () => {
  assert.equal(isReminderWindow(21, cfg, new Date('2026-01-14T19:59:58Z')), true); // 20:59:58
  assert.equal(isReminderWindow(21, cfg, new Date('2026-01-14T19:55:00Z')), true); // 20:55
  assert.equal(isReminderWindow(21, cfg, new Date('2026-01-14T19:54:59Z')), false); // 20:54
  assert.equal(isReminderWindow(21, cfg, new Date('2026-01-14T20:59:59Z')), true); // 21:59
  assert.equal(isReminderWindow(21, cfg, new Date('2026-01-14T21:00:00Z')), false); // 22:00
});

test('la fenêtre d\'un rappel de minuit commence la veille à 23h55', () => {
  assert.equal(isReminderWindow(0, cfg, new Date('2026-01-14T22:56:00Z')), true); // 23:56 à Paris
  assert.equal(isReminderWindow(0, cfg, new Date('2026-01-14T23:10:00Z')), true); // 00:10
  assert.equal(isReminderWindow(0, cfg, new Date('2026-01-14T22:30:00Z')), false); // 23:30
});

test('le jour du passage à l\'heure d\'été, le rappel part bien à 21h locales', () => {
  // 29 mars 2026 : Paris passe à UTC+2 à 2h du matin
  assert.equal(isReminderWindow(21, cfg, new Date('2026-03-29T19:00:00Z')), true);
  assert.equal(isReminderWindow(21, cfg, new Date('2026-03-29T20:00:00Z')), false);
  assert.equal(getTodayISO(cfg, new Date('2026-03-29T19:00:00Z')), '2026-03-29');
});

// ─── Messages des notifications ──────────────────────────────────────────────

test('sans nom configuré, le médicament n\'apparaît pas dans la notification', () => {
  const m = getNotificationMessage(state(addDaysISO(START, 4)), cfg);
  assert.equal(m.title, 'Traitement 💊');
  assert.equal(m.body, 'Jour 5/21 — prends ton traitement');
});

test('le nom, le nom commun et son genre sont repris dans les phrases', () => {
  const named = loadConfig({ MED_NAME: 'Exemplix', MED_NOUN: 'pilule', MED_NOUN_FEMININE: 'true' });
  assert.equal(
    getNotificationMessage(state(addDaysISO(START, 4), 1, named), named).body,
    'Jour 5/21 — prends ta pilule Exemplix'
  );
  assert.equal(getNotificationMessage(state(START, 1, named), named).title, 'Reprise 💊');
  assert.equal(
    getNotificationMessage(state(addDaysISO(START, 27), 1, named), named).body,
    'Dernier jour de pause — tu reprends la pilule demain !'
  );
  assert.equal(
    getBackupMessage(named).body,
    "Tu n'as pas encore confirmé avoir pris ta pilule ce soir — n'oublie pas !"
  );
});

test('pendant la pause de la dernière plaquette, le message rappelle de racheter une boîte', () => {
  const middle = getNotificationMessage(state(addDaysISO(START, 23), 3), cfg);
  assert.equal(middle.title, 'Pause');
  assert.match(middle.body, /^Jour de pause 3\/7 — pas de traitement aujourd'hui/);
  assert.match(middle.body, /racheter une boîte/);

  const last = getNotificationMessage(state(addDaysISO(START, 27), 3), cfg);
  assert.equal(last.title, 'Reprise demain');
  assert.match(last.body, /racheter une boîte/);

  assert.doesNotMatch(getNotificationMessage(state(addDaysISO(START, 23), 1), cfg).body, /racheter/);
});

// ─── Autres cycles ───────────────────────────────────────────────────────────

test('un cycle 24/4 change de phase au 25e jour', () => {
  const c = loadConfig({ PILL_DAYS: '24', PAUSE_DAYS: '4' });
  assert.equal(state(addDaysISO(START, 23), 1, c).phase, 'pill');
  assert.equal(state(addDaysISO(START, 24), 1, c).phase, 'pause');
  assert.equal(state(addDaysISO(START, 24), 1, c).pauseDayNumber, 1);
  assert.equal(state(addDaysISO(START, 28), 1, c).cycleDay, 1);
});

test('une prise continue (pause de 0 jour) n\'a jamais de pause', () => {
  const c = loadConfig({ PILL_DAYS: '28', PAUSE_DAYS: '0', PACKS_PER_BOX: '1' });
  for (let i = 0; i < 90; i++) {
    const s = state(addDaysISO(START, i), 1, c);
    assert.equal(s.phase, 'pill', `jour ${i}`);
    assert.equal(s.needsNewBox, false);
    assert.equal(s.packNumberInBox, 1);
  }
  assert.equal(buildCycleDays(START, 1, c).length, 28);
});
