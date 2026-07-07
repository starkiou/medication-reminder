module.exports = async function handler(req, res) {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    res.status(500).json({ error: 'VAPID_PUBLIC_KEY manquante' });
    return;
  }
  res.status(200).json({ publicKey: key });
};
