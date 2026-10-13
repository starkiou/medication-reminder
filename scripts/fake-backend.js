// Faux backend : une base Supabase en mémoire et de quoi appeler un
// endpoint comme le ferait Vercel. Servent aussi au serveur de développement.

/**
 * Imite la petite partie de l'API Supabase utilisée par lib/store.js, sur une
 * seule ligne gardée en mémoire.
 */
function createFakeSupabase(initialRow = null) {
  const db = { row: initialRow ? { ...initialRow } : null, failNext: null };

  function result(data = null) {
    if (db.failNext) {
      const error = db.failNext;
      db.failNext = null;
      return Promise.resolve({ data: null, error });
    }
    return Promise.resolve({ data, error: null });
  }

  const client = {
    db,
    from() {
      return {
        select() {
          return { eq: () => ({ maybeSingle: () => result(db.row ? { ...db.row } : null) }) };
        },
        update(fields) {
          return {
            eq: () => {
              if (db.row) Object.assign(db.row, fields);
              return result();
            },
          };
        },
        upsert(fields) {
          db.row = {
            missed_dates: [],
            confirmed_dates: [],
            push_subscription: null,
            created_at: new Date().toISOString(),
            ...(db.row || {}),
            ...fields,
          };
          return result();
        },
      };
    },
  };
  return client;
}

/** Appelle un handler et renvoie { status, body }. */
async function call(handler, { method = 'GET', headers = {}, body = undefined, query = {} } = {}) {
  const response = { status: 200, body: undefined };
  const res = {
    status(code) {
      response.status = code;
      return res;
    },
    json(payload) {
      response.body = payload;
      return res;
    },
  };
  const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  await handler({ method, headers: lowered, body, query }, res);
  return response;
}

module.exports = { createFakeSupabase, call };
