const REPO = 'hvx2x7hk8h-tech/jugendensemblewsp';
const FILE = 'content/reservations.json';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

function decodeBase64(value) {
  const binary = atob(value.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function github(context, path, options = {}) {
  const token = context.env.GITHUB_TOKEN;
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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequestPost(context) {
  try {
    const reservation = await context.request.json();
    const required = ['id', 'name', 'email', 'eventTitle', 'quantity'];
    if (!required.every((key) => reservation[key])) throw new Error('Missing reservation data');

    const current = await github(context, FILE);
    const store = JSON.parse(decodeBase64(current.content));
    store.reservations = Array.isArray(store.reservations) ? store.reservations : [];
    store.reservations.push({
      ...reservation,
      quantity: Number(reservation.quantity),
      paymentStatus: 'open',
      paymentMethod: null,
      checkedIn: false,
      createdAt: new Date().toISOString()
    });

    await github(context, FILE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Neue Reservierung ${reservation.id}`,
        content: encodeBase64(JSON.stringify(store, null, 2)),
        sha: current.sha
      })
    });
    return Response.json({ ok: true }, { status: 201, headers });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Reservierung konnte nicht gespeichert werden.' }, { status: 500, headers });
  }
}
