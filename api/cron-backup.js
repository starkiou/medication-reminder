const webpush = require('web-push');
const { getSupabase } = require('../lib/supabase');
const { computeState, getParisTodayISO } = require('../lib/cycle');

function currentParisHour() {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(new Date()), 10);
}

module.exports = async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Non autorisé' });
      return;
    }
  }

  try {
    if (currentParisHour() !== 22) {
      res.status(200).json({ skipped: true, reason: 'pas 22h à Paris' });
      return;
    }

    const supabase = getSupabase();
    const { data: row, error } = await supabase
      .from('app_state')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;
    if (!row || !row.push_subscription) {
      res.status(200).json({ skipped: true, reason: "pas d'abonnement push" });
      return;
    }

    const state = computeState(row.pack_start_date, row.pack_number_in_box);

    // Pas de rappel de secours pendant la pause : rien à confirmer ces jours-là.
    if (state.phase !== 'pill') {
      res.status(200).json({ skipped: true, reason: 'jour de pause, pas de rappel de secours' });
      return;
    }

    const todayISO = getParisTodayISO();
    const alreadyConfirmed = (row.confirmed_dates || []).includes(todayISO);

    if (alreadyConfirmed) {
      res.status(200).json({ skipped: true, reason: 'déjà confirmé aujourd\'hui' });
      return;
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:contact@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const message = {
      title: 'Rappel de secours 🌸',
      body: "Tu n'as pas encore confirmé avoir pris ta pilule ce soir — n'oublie pas !",
    };

    try {
      await webpush.sendNotification(row.push_subscription, JSON.stringify(message));
    } catch (pushErr) {
      if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
        await supabase.from('app_state').update({ push_subscription: null }).eq('id', 1);
      } else {
        throw pushErr;
      }
    }

    res.status(200).json({ ok: true, sent: message });
  } catch (err) {
    console.error('cron-backup error', err);
    res.status(500).json({
      error: err.message || 'Erreur serveur',
      pushStatusCode: err.statusCode || null,
      pushBody: err.body || null,
    });
  }
};
