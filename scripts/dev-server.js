// Serveur de développement : sert public/ et les endpoints de api/ comme le
// ferait Vercel, avec une base en mémoire et des notifications simulées.
// Rien n'est lu ni écrit dans Supabase, aucune vraie notification ne part.
//
//   npm run dev                 → http://localhost:3000, code d'accès « dev »
//   PORT=4000 ACCESS_CODE=x npm run dev
//
// La base repart de zéro à chaque lancement. DEV_SEED=1 la préremplit avec un
// suivi déjà configuré, pour arriver directement sur l'écran principal.

const http = require('http');
const fs = require('fs');
const path = require('path');

const { createFakeSupabase } = require('./fake-backend');
const { setSupabaseClient } = require('../lib/supabase');
const { setPushSender } = require('../lib/push');
const { getTodayISO, addDaysISO } = require('../lib/cycle');

process.env.ACCESS_CODE = process.env.ACCESS_CODE || 'dev';
process.env.CRON_SECRET = process.env.CRON_SECRET || 'dev-cron';
process.env.VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

const seeded = process.env.DEV_SEED
  ? {
      id: 1,
      pack_start_date: addDaysISO(getTodayISO(), -Number(process.env.DEV_SEED_DAY || 9)),
      pack_number_in_box: 2,
      missed_dates: [addDaysISO(getTodayISO(), -3)],
      confirmed_dates: [addDaysISO(getTodayISO(), -1), addDaysISO(getTodayISO(), -2), addDaysISO(getTodayISO(), -5)],
      push_subscription: { endpoint: 'https://push.example.com/dev' },
      created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
    }
  : null;

setSupabaseClient(createFakeSupabase(seeded));
setPushSender(async (subscription, payload) => {
  console.log('[push simulé]', payload);
});

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const API_DIR = path.join(__dirname, '..', 'api');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch (e) {
        resolve(undefined);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    const name = path.basename(url.pathname);
    const file = path.join(API_DIR, `${name}.js`);
    if (!/^[a-z-]+$/.test(name) || !fs.existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Introuvable' }));
      return;
    }
    req.query = Object.fromEntries(url.searchParams);
    req.body = await readBody(req);
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
      return res;
    };
    await require(file)(req, res);
    return;
  }

  const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(PUBLIC_DIR, relative);
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('Introuvable');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Serveur de développement : http://localhost:${port}`);
  console.log(`Code d'accès : ${process.env.ACCESS_CODE}`);
});
