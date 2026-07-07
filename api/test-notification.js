const webpush = require('web-push');
const { getSupabase } = require('../lib/supabase');
const { computeState, getNotificationMessage } = require('../lib/cycle');

// Endpoint de TEST uniquement : envoie la notification tout de suite, sans
// vérifier l'heure. Protégé par la même clé que le cron (CRON_SECRET), passée
// en query string pour pouvoir être appelée simplement depuis un navigateur :
//   https://ton-app.vercel.app/api/test-notification?key=TA_CLE
module.exports = async function handler(req, res) {
  const requiredKey = process.env.CRON_SECRET;

  if (!requiredKey) {
    res.status(400).json({
      error:
        "Définis la variable d'environnement CRON_SECRET sur Vercel avant d'utiliser cet endpoint de test (sinon n'importe qui connaissant l'URL pourrait déclencher une notification).",
    });
    return;
  }

  if (req.query.key !== requiredKey) {
    res.status(401).json({ error: 'Clé invalide' });
    return;
  }

  try {
    const supabase = getSupabase();
    const { data: row, error } = await supabase
      .from('app_state')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) throw error;
    if (!row) {
      res.status(200).json({ skipped: true, reason: "Onboarding pas encore fait dans l'app" });
      return;
    }
    if (!row.push_subscription) {
      res.status(200).json({ skipped: true, reason: "Pas encore d'abonnement push enregistré" });
      return;
    }

    const state = computeState(row.pack_start_date, row.pack_number_in_box);
    const message = getNotificationMessage(state);

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:contact@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    await webpush.sendNotification(row.push_subscription, JSON.stringify(message));

    res.status(200).json({
      ok: true,
      sent: message,
      note: "Notification envoyée immédiatement, sans tenir compte de l'heure (endpoint de test).",
    });
  } catch (err) {
    console.error('test-notification error', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
