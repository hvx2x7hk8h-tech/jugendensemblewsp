const REPO = 'hvx2x7hk8h-tech/jugendensemblewsp';
const FILE = 'content/reservations.json';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

async function github(path, options = {}) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not configured');
  const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`GitHub request failed (${response.status})`);
  return response.json();
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const reservation = JSON.parse(event.body || '{}');
    const required = ['id', 'name', 'email', 'eventTitle', 'quantity'];
    if (!required.every((key) => reservation[key])) throw new Error('Missing reservation data');

    const current = await github(FILE);
    const store = JSON.parse(Buffer.from(current.content, 'base64').toString('utf8'));
    store.reservations = Array.isArray(store.reservations) ? store.reservations : [];
    store.reservations.push({
      ...reservation,
      quantity: Number(reservation.quantity),
      paymentStatus: 'open',
      paymentMethod: null,
      checkedIn: false,
      createdAt: new Date().toISOString()
    });

    await github(FILE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Neue Reservierung ${reservation.id}`,
        content: Buffer.from(JSON.stringify(store, null, 2)).toString('base64'),
        sha: current.sha
      })
    });
    return { statusCode: 201, headers, body: JSON.stringify({ ok: true }) };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Reservierung konnte nicht gespeichert werden.' }) };
  }
};
