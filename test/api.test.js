const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { createFakeSupabase, call } = require('../scripts/fake-backend');
const { setSupabaseClient } = require('../lib/supabase');
const { setPushSender } = require('../lib/push');
const { setNow } = require('../lib/clock');

const stateHandler = require('../api/state');
const historyHandler = require('../api/history');
const subscribeHandler = require('../api/subscribe');
const cronHandler = require('../api/cron');
const backupHandler = require('../api/cron-backup');
const testNotificationHandler = require('../api/test-notification');

const ACCESS = { 'X-Access-Code': 'code-de-test' };
const CRON = { Authorization: 'Bearer secret-cron' };
const SUBSCRIPTION = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'k', auth: 'a' } };

// 14 janvier 2026 : 21h à Paris = 20h UTC (heure d'hiver)
const AT_21H = '2026-01-14T20:00:00Z';
const AT_22H = '2026-01-14T21:00:00Z';
const AT_NOON = '2026-01-14T11:00:00Z';

let db;
let sent;
let logged;
const realConsoleError = console.error;

/** Ligne en base : plaquette commencée le 5 janvier, donc 10e jour le 14. */
function onboardedRow(extra = {}) {
  return {
    id: 1,
    pack_start_date: '2026-01-05',
    pack_number_in_box: 1,
    missed_dates: [],
    confirmed_dates: [],
    push_subscription: SUBSCRIPTION,
    created_at: '2026-01-05T10:00:00Z',
    ...extra,
  };
}

function useDb(row) {
  db = createFakeSupabase(row);
  setSupabaseClient(db);
  return db.db;
}

beforeEach(() => {
  process.env.ACCESS_CODE = 'code-de-test';
  process.env.CRON_SECRET = 'secret-cron';
  sent = [];
  logged = [];
  console.error = (...args) => logged.push(args);
  setPushSender(async (subscription, payload) => {
    sent.push({ subscription, message: JSON.parse(payload) });
  });
  setNow(AT_NOON);
  useDb(null);
});

afterEach(() => {
  console.error = realConsoleError;
  setNow(null);
});

// ─── Contrôle d'accès ────────────────────────────────────────────────────────

test('sans code d\'accès, aucun endpoint de l\'application ne répond', async () => {
  useDb(onboardedRow());
  for (const handler of [stateHandler, historyHandler, subscribeHandler]) {
    assert.equal((await call(handler)).status, 401);
    assert.equal((await call(handler, { headers: { 'X-Access-Code': 'mauvais' } })).status, 401);
  }
});

test('un mauvais code ne permet ni de lire ni de modifier le suivi', async () => {
  const stored = useDb(onboardedRow());
  const wrong = { 'X-Access-Code': 'mauvais' };

  const read = await call(stateHandler, { headers: wrong });
  assert.deepEqual(read.body, { error: 'Non autorisé' });

  await call(stateHandler, { method: 'POST', headers: wrong, body: { action: 'confirm_taken_today' } });
  await call(subscribeHandler, {
    method: 'POST',
    headers: wrong,
    body: { subscription: { endpoint: 'https://pirate.example.com' }, packStartDate: '2026-01-01', packNumberInBox: 1 },
  });
  assert.deepEqual(stored.row.confirmed_dates, []);
  assert.deepEqual(stored.row.push_subscription, SUBSCRIPTION);
});

test('si ACCESS_CODE n\'est pas configuré, l\'accès est refusé plutôt qu\'ouvert', async () => {
  delete process.env.ACCESS_CODE;
  useDb(onboardedRow());
  assert.equal((await call(stateHandler, { headers: ACCESS })).status, 503);
  assert.equal((await call(stateHandler, { headers: { 'X-Access-Code': '' } })).status, 503);
});

test('les endpoints de cron exigent CRON_SECRET', async () => {
  useDb(onboardedRow());
  setNow(AT_21H);
  for (const handler of [cronHandler, backupHandler, testNotificationHandler]) {
    assert.equal((await call(handler)).status, 401);
    assert.equal((await call(handler, { headers: { Authorization: 'Bearer faux' } })).status, 401);
    // le code de l'application ne sert pas de secret de cron
    assert.equal((await call(handler, { headers: { Authorization: 'Bearer code-de-test' } })).status, 401);
  }
  delete process.env.CRON_SECRET;
  assert.equal((await call(cronHandler, { headers: CRON })).status, 503);
  assert.equal(sent.length, 0);
});

// ─── /api/state ──────────────────────────────────────────────────────────────

test('avant la configuration, l\'état indique qu\'il reste à configurer et donne les réglages', async () => {
  const res = await call(stateHandler, { headers: ACCESS });
  assert.equal(res.status, 200);
  assert.equal(res.body.onboarded, false);
  assert.equal(res.body.config.pillDays, 21);
  assert.equal(res.body.config.packsPerBox, 3);
});

test('l\'état décrit le jour du cycle et les 28 jours de l\'anneau', async () => {
  useDb(onboardedRow());
  const res = await call(stateHandler, { headers: ACCESS });
  assert.equal(res.body.onboarded, true);
  assert.equal(res.body.cycleDay, 10);
  assert.equal(res.body.phase, 'pill');
  assert.equal(res.body.pillsRemainingInPack, 12);
  assert.equal(res.body.confirmedToday, false);
  assert.equal(res.body.hasPushSubscription, true);
  assert.equal(res.body.days.length, 28);
  assert.equal(res.body.days[9].status, 'today');
  // l'abonnement push lui-même n'est jamais renvoyé au client
  assert.equal(JSON.stringify(res.body).includes('push.example.com'), false);
});

test('confirmer la prise l\'enregistre pour aujourd\'hui, une seule fois', async () => {
  const stored = useDb(onboardedRow());
  const confirm = { method: 'POST', headers: ACCESS, body: { action: 'confirm_taken_today' } };
  assert.equal((await call(stateHandler, confirm)).status, 200);
  await call(stateHandler, confirm);
  assert.deepEqual(stored.row.confirmed_dates, ['2026-01-14']);
  assert.equal((await call(stateHandler, { headers: ACCESS })).body.confirmedToday, true);
});

test('« j\'ai oublié hier » note la veille, à la date de Paris', async () => {
  const stored = useDb(onboardedRow());
  // 00h30 à Paris le 15 : UTC est encore le 14, mais la veille est bien le 14
  setNow('2026-01-14T23:30:00Z');
  await call(stateHandler, { method: 'POST', headers: ACCESS, body: { action: 'mark_forgot_yesterday' } });
  assert.deepEqual(stored.row.missed_dates, ['2026-01-14']);
});

test('modifier la date de départ refuse les valeurs invalides', async () => {
  const stored = useDb(onboardedRow());
  const update = (body) => call(stateHandler, { method: 'POST', headers: ACCESS, body: { action: 'update_pack_start', ...body } });

  assert.equal((await update({ packStartDate: '2026-02-30', packNumberInBox: 1 })).status, 400);
  assert.equal((await update({ packStartDate: '14/01/2026', packNumberInBox: 1 })).status, 400);
  assert.equal((await update({ packStartDate: '2026-01-10', packNumberInBox: 4 })).status, 400);
  assert.equal((await update({ packStartDate: '2026-01-10', packNumberInBox: 0 })).status, 400);
  assert.equal((await update({ packStartDate: '2026-01-10', packNumberInBox: '2' })).status, 400);
  assert.equal(stored.row.pack_start_date, '2026-01-05');

  assert.equal((await update({ packStartDate: '2026-01-10', packNumberInBox: 2 })).status, 200);
  assert.equal(stored.row.pack_start_date, '2026-01-10');
  assert.equal(stored.row.pack_number_in_box, 2);
});

test('une action sur un suivi pas encore configuré est signalée, pas avalée', async () => {
  const res = await call(stateHandler, { method: 'POST', headers: ACCESS, body: { action: 'confirm_taken_today' } });
  assert.equal(res.status, 409);
});

test('une action inconnue ou une méthode non prévue est refusée', async () => {
  useDb(onboardedRow());
  assert.equal((await call(stateHandler, { method: 'POST', headers: ACCESS, body: { action: 'efface_tout' } })).status, 400);
  assert.equal((await call(stateHandler, { method: 'POST', headers: ACCESS })).status, 400);
  assert.equal((await call(stateHandler, { method: 'DELETE', headers: ACCESS })).status, 405);
});

// ─── /api/subscribe ──────────────────────────────────────────────────────────

test('s\'abonner crée le suivi avec la plaquette en cours', async () => {
  const stored = useDb(null);
  const res = await call(subscribeHandler, {
    method: 'POST',
    headers: ACCESS,
    body: { subscription: SUBSCRIPTION, packStartDate: '2026-01-12', packNumberInBox: 2 },
  });
  assert.equal(res.status, 200);
  assert.equal(stored.row.pack_start_date, '2026-01-12');
  assert.equal(stored.row.pack_number_in_box, 2);
  assert.deepEqual(stored.row.push_subscription, SUBSCRIPTION);
});

test('se réabonner garde l\'historique des oublis et des confirmations', async () => {
  const stored = useDb(onboardedRow({ missed_dates: ['2026-01-08'], confirmed_dates: ['2026-01-09'] }));
  const replacement = { endpoint: 'https://push.example.com/nouveau' };
  await call(subscribeHandler, {
    method: 'POST',
    headers: ACCESS,
    body: { subscription: replacement, packStartDate: '2026-01-05', packNumberInBox: 1 },
  });
  assert.deepEqual(stored.row.push_subscription, replacement);
  assert.deepEqual(stored.row.missed_dates, ['2026-01-08']);
  assert.deepEqual(stored.row.confirmed_dates, ['2026-01-09']);
});

test('un abonnement ou une plaquette invalides sont refusés', async () => {
  const stored = useDb(null);
  const subscribe = (body) => call(subscribeHandler, { method: 'POST', headers: ACCESS, body });
  const valid = { subscription: SUBSCRIPTION, packStartDate: '2026-01-12', packNumberInBox: 1 };

  assert.equal((await subscribe({ ...valid, subscription: null })).status, 400);
  assert.equal((await subscribe({ ...valid, subscription: { endpoint: 'http://non-chiffre.example.com' } })).status, 400);
  assert.equal((await subscribe({ ...valid, subscription: 'https://push.example.com' })).status, 400);
  assert.equal((await subscribe({ ...valid, packStartDate: 'demain' })).status, 400);
  assert.equal((await subscribe({ ...valid, packNumberInBox: 9 })).status, 400);
  assert.equal((await subscribe(undefined)).status, 400);
  assert.equal(stored.row, null);
  assert.equal((await call(subscribeHandler, { headers: ACCESS })).status, 405);
});

// ─── /api/history ────────────────────────────────────────────────────────────

test('l\'historique part de la création du suivi et marque les oublis', async () => {
  useDb(onboardedRow({ missed_dates: ['2026-01-08'] }));
  const res = await call(historyHandler, { headers: ACCESS });
  assert.equal(res.body.startDate, '2026-01-05');
  assert.equal(res.body.days.length, 10); // du 5 au 14 inclus
  assert.equal(res.body.days[0].date, '2026-01-05');
  assert.equal(res.body.days[9].date, '2026-01-14');
  assert.equal(res.body.days[9].isToday, true);
  assert.equal(res.body.days[3].missed, true);
  assert.equal(res.body.days.filter((d) => d.missed).length, 1);
  assert.ok(res.body.days.every((d) => d.phase === 'pill'));
});

test('l\'historique est limité à 365 jours et au nombre demandé', async () => {
  useDb(onboardedRow({ created_at: '2020-01-01T10:00:00Z' }));
  assert.equal((await call(historyHandler, { headers: ACCESS })).body.days.length, 365);
  assert.equal((await call(historyHandler, { headers: ACCESS, query: { days: '7' } })).body.days.length, 7);
  assert.equal((await call(historyHandler, { headers: ACCESS, query: { days: '-3' } })).body.days.length, 1);
  assert.equal((await call(historyHandler, { headers: ACCESS, query: { days: 'abc' } })).body.days.length, 365);
});

test('l\'historique traverse la pause et le changement de plaquette', async () => {
  // Suivi créé le 5 janvier, consulté le 4 février (31e jour) : 21 prises, 7 pauses, 3 prises
  useDb(onboardedRow());
  setNow('2026-02-04T11:00:00Z');
  const days = (await call(historyHandler, { headers: ACCESS })).body.days;
  assert.equal(days.length, 31);
  assert.equal(days.filter((d) => d.phase === 'pause').length, 7);
  assert.equal(days[20].phase, 'pill');
  assert.equal(days[21].phase, 'pause');
  assert.equal(days[28].phase, 'pill');
  assert.equal(days[27].packNumberInBox, 1);
  assert.equal(days[28].packNumberInBox, 2);
});

// ─── /api/cron : rappel principal ────────────────────────────────────────────

test('à 21h, le rappel du jour est envoyé', async () => {
  useDb(onboardedRow());
  setNow(AT_21H);
  const res = await call(cronHandler, { headers: CRON });
  assert.deepEqual(res.body, { ok: true, delivered: true });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].subscription, SUBSCRIPTION);
  assert.equal(sent[0].message.body, 'Jour 10/21 — prends ton traitement');
});

test('en dehors de 21h, rien n\'est envoyé', async () => {
  useDb(onboardedRow());
  for (const time of [AT_NOON, AT_22H, '2026-01-14T19:30:00Z']) {
    setNow(time);
    const res = await call(cronHandler, { headers: CRON });
    assert.equal(res.body.skipped, true, time);
  }
  assert.equal(sent.length, 0);
});

test('si la prise est déjà confirmée, le rappel de 21h n\'est pas envoyé', async () => {
  useDb(onboardedRow({ confirmed_dates: ['2026-01-14'] }));
  setNow(AT_21H);
  assert.equal((await call(cronHandler, { headers: CRON })).body.skipped, true);
  assert.equal(sent.length, 0);
});

test('une confirmation de la veille n\'empêche pas le rappel du jour', async () => {
  useDb(onboardedRow({ confirmed_dates: ['2026-01-13'] }));
  setNow(AT_21H);
  await call(cronHandler, { headers: CRON });
  assert.equal(sent.length, 1);
});

test('pendant la pause, le rappel de 21h annonce la pause', async () => {
  // 21 jours de prise du 5 au 25 janvier : le 27 est le 2e jour de pause
  useDb(onboardedRow());
  setNow('2026-01-27T20:00:00Z');
  await call(cronHandler, { headers: CRON });
  assert.equal(sent[0].message.title, 'Pause');
  assert.match(sent[0].message.body, /^Jour de pause 2\/7/);
});

test('au changement de plaquette, la base est mise à jour avant l\'envoi', async () => {
  const stored = useDb(onboardedRow());
  setNow('2026-02-02T20:00:00Z'); // 29e jour : jour 1 de la plaquette 2
  await call(cronHandler, { headers: CRON });
  assert.equal(stored.row.pack_start_date, '2026-02-02');
  assert.equal(stored.row.pack_number_in_box, 2);
  assert.equal(sent[0].message.title, 'Reprise 💊');
});

test('sans abonnement push, le cron ne tente aucun envoi', async () => {
  useDb(onboardedRow({ push_subscription: null }));
  setNow(AT_21H);
  assert.equal((await call(cronHandler, { headers: CRON })).body.skipped, true);
  useDb(null);
  assert.equal((await call(cronHandler, { headers: CRON })).body.skipped, true);
  assert.equal(sent.length, 0);
});

test('un abonnement devenu invalide est retiré de la base', async () => {
  for (const statusCode of [404, 410]) {
    const stored = useDb(onboardedRow());
    setNow(AT_21H);
    setPushSender(async () => {
      throw Object.assign(new Error('gone'), { statusCode });
    });
    const res = await call(cronHandler, { headers: CRON });
    assert.deepEqual(res.body, { ok: true, delivered: false });
    assert.equal(stored.row.push_subscription, null);
  }
});

test('une panne du service de push renvoie une erreur sans détail', async () => {
  const stored = useDb(onboardedRow());
  setNow(AT_21H);
  setPushSender(async () => {
    throw Object.assign(new Error('clé VAPID refusée : détail interne'), { statusCode: 403, body: 'secret' });
  });
  const res = await call(cronHandler, { headers: CRON });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'Erreur serveur' });
  assert.deepEqual(stored.row.push_subscription, SUBSCRIPTION); // l'abonnement est gardé
  assert.equal(logged.length, 1); // le détail part dans les journaux du serveur
});

// ─── /api/cron-backup : rappel de secours ────────────────────────────────────

test('à 22h, le rappel de secours part si la prise n\'est pas confirmée', async () => {
  useDb(onboardedRow());
  setNow(AT_22H);
  const res = await call(backupHandler, { headers: CRON });
  assert.deepEqual(res.body, { ok: true, delivered: true });
  assert.equal(sent[0].message.title, 'Rappel de secours 🌸');
});

test('le rappel de secours ne part ni si la prise est confirmée, ni pendant la pause, ni hors de 22h', async () => {
  useDb(onboardedRow({ confirmed_dates: ['2026-01-14'] }));
  setNow(AT_22H);
  assert.equal((await call(backupHandler, { headers: CRON })).body.skipped, true);

  useDb(onboardedRow());
  setNow('2026-01-27T21:00:00Z'); // 22h un jour de pause
  assert.equal((await call(backupHandler, { headers: CRON })).body.skipped, true);

  setNow(AT_21H);
  assert.equal((await call(backupHandler, { headers: CRON })).body.skipped, true);
  assert.equal(sent.length, 0);
});

// ─── /api/test-notification ──────────────────────────────────────────────────

test('la notification de test part à n\'importe quelle heure', async () => {
  useDb(onboardedRow());
  setNow(AT_NOON);
  const res = await call(testNotificationHandler, { headers: CRON });
  assert.equal(res.body.ok, true);
  assert.equal(sent[0].message.body, 'Jour 10/21 — prends ton traitement');

  await call(testNotificationHandler, { headers: CRON, query: { backup: '1' } });
  assert.equal(sent[1].message.title, 'Rappel de secours 🌸');
});

test('le secret passé dans l\'URL n\'est plus accepté', async () => {
  useDb(onboardedRow());
  const res = await call(testNotificationHandler, { query: { key: 'secret-cron' } });
  assert.equal(res.status, 401);
  assert.equal(sent.length, 0);
});

// ─── Pannes de la base ───────────────────────────────────────────────────────

test('une erreur de la base n\'expose aucun détail au client', async () => {
  useDb(onboardedRow());
  db.db.failNext = { message: 'relation "app_state" does not exist', code: '42P01' };
  const res = await call(stateHandler, { headers: ACCESS });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: 'Erreur serveur' });
});
