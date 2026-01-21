export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SAFE body handling (INI YANG FIX ERROR 500)
  let body = {};
  try {
    body = req.body || {};
  } catch (e) {
    body = {};
  }

  const message = body.message || 'pesan kosong';

  return res.status(200).json({
    reply: `Backend tembus 🔥 Pesan kamu: ${message}`
  });
}