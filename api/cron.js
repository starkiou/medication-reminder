const webpush = require('web-push');
const { getSupabase } = require('../lib/supabase');
const { computeState, getNotificationMessage } = require('../lib/cycle');

function currentParisHour() {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    hour12: false,
  });
  return parseInt(formatter.format(new Date()), 10);
}

module.exports = async function handler(req, res) {
  // Vercel Cron envoie automatiquement ce header si CRON_SECRET est défini
  if (process.env.CRON_SECRET) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: 'Non autorisé' });
      return;
    }
  }

  try {
    // Vercel déclenche ce cron 2x/jour (été + hiver) pour viser 21h Paris
    // quelle que soit l'heure d'été/hiver. On ignore l'appel qui ne tombe pas
    // exactement sur 21h locale.
    if (currentParisHour() !== 21) {
      res.status(200).json({ skipped: true, reason: 'pas 21h à Paris' });
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
      res.status(200).json({ skipped: true, reason: 'pas d\'abonnement push' });
      return;
    }

    const state = computeState(row.pack_start_date, row.pack_number_in_box);

    // Si le cycle a avancé (nouvelle plaquette / nouvelle boîte), on
    // réécrit les valeurs en base pour que le prochain calcul reparte propre.
    if (
      state.effectivePackStartDate !== row.pack_start_date ||
      state.effectivePackNumberInBox !== row.pack_number_in_box
    ) {
      await supabase
        .from('app_state')
        .update({
          pack_start_date: state.effectivePackStartDate,
          pack_number_in_box: state.effectivePackNumberInBox,
          updated_at: new Date().toISOString(),
        })
        .eq('id', 1);
    }

    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:contact@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    const message = getNotificationMessage(state);

    try {
      await webpush.sendNotification(
        row.push_subscription,
        JSON.stringify(message)
      );
    } catch (pushErr) {
      // 404/410 = l'abonnement n'est plus valide (app désinstallée, permission retirée...)
      if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
        await supabase
          .from('app_state')
          .update({ push_subscription: null })
          .eq('id', 1);
      } else {
        throw pushErr;
      }
    }

    res.status(200).json({ ok: true, sent: message });
  } catch (err) {
    console.error('cron error', err);
    res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
