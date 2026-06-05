/**
 * tickets.js — Jugendensemble WSP
 * TicketTailor Integration & Show Management
 * ─────────────────────────────────────────
 *
 * SETUP:
 * 1. Erstelle einen kostenlosen Account auf tickettailor.com
 * 2. Erstelle für jede Vorstellung ein Event (kostenlose Tickets)
 * 3. Kopiere die Widget-ID oder Event-ID und trage sie in events.json ein:
 *    "tt_widget_id": "DEINE_WIDGET_ID"
 *
 * TICKETTAILOR WIDGET ID FINDEN:
 * Dashboard → Events → Dein Event → "Embed" → Widget-ID aus dem Code kopieren
 */

// ── KONFIGURATION ──────────────────────────────────────────────────
const TT_CONFIG = {
  // Deine TicketTailor Box-Office URL (aus Dashboard → Settings → Box Office)
  // Format: https://www.tickettailor.com/events/DEIN-SLUG/
  boxOfficeUrl: 'https://www.tickettailor.com/events/jugendensemblewsp/',

  // Widget-Script URL (nicht ändern)
  widgetScriptUrl: 'https://cdn.tickettailor.com/js/widgets/min/widget.js',

  // Primärfarbe für das Widget (überschreibt TicketTailor Standard)
  primaryColor: '#c9a84c',
};

// ── TICKET SYSTEM INIT ──────────────────────────────────────────────
async function initTicketSystem() {
  const data = await loadJSON('/content/events.json');
  if (!data || !data.events) return;

  const upcoming = data.events.filter(e => !e.past);
  const past     = data.events.filter(e => e.past);

  renderVenueFilter(upcoming);
  renderShows('shows-upcoming', upcoming, false);
  renderShows('shows-past', past, true);

  // Keyboard: ESC closes modal
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

// ── VENUE FILTER ────────────────────────────────────────────────────
function renderVenueFilter(events) {
  const container = document.getElementById('venue-filter');
  if (!container) return;

  const venues = ['Alle', ...new Set(events.map(e => e.venue).filter(Boolean))];

  if (venues.length <= 2) {
    // Only one venue → hide filter
    container.style.display = 'none';
    return;
  }

  container.innerHTML = venues.map((v, i) => `
    <button
      class="venue-btn ${i === 0 ? 'active' : ''}"
      onclick="filterByVenue(this, '${v === 'Alle' ? 'all' : v}')"
    >${v}</button>
  `).join('');
}

function filterByVenue(btn, venue) {
  document.querySelectorAll('.venue-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  document.querySelectorAll('.event-card-v2[data-venue]').forEach(card => {
    if (venue === 'all' || card.dataset.venue === venue) {
      card.classList.remove('hidden');
    } else {
      card.classList.add('hidden');
    }
  });
}

// ── RENDER SHOWS ────────────────────────────────────────────────────
function renderShows(containerId, events, isPast) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (events.length === 0) {
    container.innerHTML = `
      <div class="no-shows">
        <span class="icon">🎭</span>
        <p>${isPast ? 'Noch keine vergangenen Vorstellungen.' : 'Aktuell keine kommenden Vorstellungen geplant. Schau bald wieder vorbei!'}</p>
      </div>`;
    return;
  }

  container.innerHTML = events.map(ev => buildShowCard(ev, isPast)).join('');

  // Animate new cards
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

function buildShowCard(ev, isPast) {
  const poster = ev.image
    ? `<img class="ev-poster" src="${ev.image}" alt="${ev.title}" loading="lazy">`
    : `<div class="ev-poster-placeholder">🎭</div>`;

  const dateInfo = [
    ev.date ? `<span class="ev-detail-item"><span class="icon">📅</span>${ev.date}</span>` : '',
    ev.time ? `<span class="ev-detail-item"><span class="icon">🕐</span>${ev.time}</span>` : '',
    ev.venue ? `<span class="ev-detail-item"><span class="icon">📍</span>${ev.venue}</span>` : '',
  ].filter(Boolean).join('');

  const actions = isPast
    ? `<span class="past-tag">Vergangen</span>`
    : ev.tt_widget_id
      ? `<div class="ev-spots" id="spots-${ev.tt_widget_id}">Kostenlos</div>
         <button class="btn-ticket" onclick="openTicketModal('${ev.tt_widget_id}', '${ev.title?.replace(/'/g, "\\'")} — ${ev.date || ''}')">
           Ticket reservieren
         </button>`
      : ev.ticket_url
        ? `<a href="${ev.ticket_url}" class="btn-ticket" style="text-decoration:none" target="_blank" rel="noopener">Tickets</a>`
        : `<span class="past-tag">Demnächst</span>`;

  return `
    <div class="event-card-v2 reveal ${isPast ? 'past' : ''}" data-venue="${ev.venue || ''}">
      ${poster}
      <div class="ev-meta">
        <span class="ev-label">${isPast ? 'Vergangene Vorstellung' : 'Kommende Vorstellung'}</span>
        <div class="ev-title-main">${ev.title || '—'}</div>
        <div class="ev-details">${dateInfo}</div>
        ${ev.description ? `<div class="ev-desc">${ev.description}</div>` : ''}
      </div>
      <div class="ev-actions">${actions}</div>
    </div>`;
}

// ── TICKET MODAL ─────────────────────────────────────────────────────
function openTicketModal(widgetId, title) {
  document.getElementById('modal-title-text').textContent = title;
  document.getElementById('ticket-modal').classList.add('open');
  document.body.style.overflow = 'hidden';

  loadTicketTailorWidget(widgetId);
}

function closeModal() {
  document.getElementById('ticket-modal').classList.remove('open');
  document.body.style.overflow = '';

  // Remove widget so it reloads fresh next time
  const container = document.getElementById('tt-embed-container');
  container.innerHTML = `
    <div id="tt-loading" style="display:flex;align-items:center;justify-content:center;min-height:300px;flex-direction:column;gap:1rem">
      <div style="width:32px;height:32px;border:2px solid rgba(201,168,76,0.2);border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite"></div>
      <span style="font-family:var(--font-display);font-size:0.6rem;letter-spacing:0.2em;text-transform:uppercase;color:var(--text-muted)">Wird geladen…</span>
    </div>`;
}

// ── TICKETTAILOR WIDGET LOADER ───────────────────────────────────────
function loadTicketTailorWidget(widgetId) {
  const container = document.getElementById('tt-embed-container');

  // Remove any previous TT script to allow fresh load
  const oldScript = document.getElementById('tt-script');
  if (oldScript) oldScript.remove();

  // Build embed HTML — TicketTailor official embed code
  container.innerHTML = `
    <div
      id="tt-widget-v2"
      style="min-height:420px"
    ></div>`;

  // Inject TicketTailor config
  window.tt = {
    widget_id: widgetId,
    // Optional: customize colors to match WSP branding
    // Note: color customization requires TicketTailor paid plan
  };

  // Load TicketTailor widget script
  const script = document.createElement('script');
  script.id = 'tt-script';
  script.src = TT_CONFIG.widgetScriptUrl;
  script.setAttribute('crossorigin', 'anonymous');
  script.onload = () => {
    // Hide loading spinner once widget has loaded
    setTimeout(() => {
      const loading = document.getElementById('tt-loading');
      if (loading) loading.style.display = 'none';
    }, 800);
  };
  script.onerror = () => {
    container.innerHTML = `
      <div style="text-align:center;padding:4rem 2rem">
        <p style="color:var(--text-muted);margin-bottom:1.5rem">Das Ticketsystem konnte nicht geladen werden.</p>
        <a href="${TT_CONFIG.boxOfficeUrl}" target="_blank" rel="noopener" class="btn">Zur Ticketseite →</a>
      </div>`;
  };
  document.body.appendChild(script);
}
