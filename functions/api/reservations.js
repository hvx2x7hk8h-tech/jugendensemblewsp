const REPO = 'hvx2x7hk8h-tech/jugendensemblewsp';
const FILE = 'content/reservations.json';
const EVENTS_FILE = 'content/events.json';

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
      'User-Agent': 'Jugendensemble-WSP-Ticketkasse',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub request failed (${response.status}): ${detail}`);
  }
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
    const eventsFile = await github(context, EVENTS_FILE);
    const store = JSON.parse(decodeBase64(current.content));
    const eventsStore = JSON.parse(decodeBase64(eventsFile.content));
    store.reservations = Array.isArray(store.reservations) ? store.reservations : [];
    eventsStore.events = Array.isArray(eventsStore.events) ? eventsStore.events : [];
    const show = eventsStore.events.find((item) => item.title === reservation.eventTitle && !item.past);
    if (!show) throw new Error('Event not found');
    const quantity = Number(reservation.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 6) throw new Error('Invalid ticket quantity');
    const capacity = Number(show.capacity) || 80;
    const free = Math.max(0, capacity - (Number(show.reserved) || 0));
    const type = quantity <= free ? 'reservation' : (show.waitlist ? 'waitlist' : null);
    if (!type) throw new Error('No seats available');

    store.reservations.push({
      ...reservation,
      type,
      quantity,
      ticketPrice: Number(show.ticket_price || 0),
      paymentStatus: 'open',
      paymentMethod: null,
      checkedIn: false,
      createdAt: new Date().toISOString()
    });
    if (type === 'reservation') show.reserved = (Number(show.reserved) || 0) + quantity;

    await github(context, EVENTS_FILE, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Plätze aktualisieren: ${show.title}`,
        content: encodeBase64(JSON.stringify(eventsStore, null, 2)),
        sha: eventsFile.sha
      })
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
    return Response.json({ ok: true, type, ticketPrice: Number(show.ticket_price || 0) }, { status: 201, headers });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Reservierung konnte nicht gespeichert werden.' }, { status: 500, headers });
  }
}
