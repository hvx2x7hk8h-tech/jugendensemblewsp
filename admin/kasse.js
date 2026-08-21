let kiosk = { products: [], sales: [] };
let reservations = [];
let cart = [];
let activeCategory = 'Alle';
let gallery = [];
let scannerStream = null;
let scannerTimer = null;

const money = (value) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const escHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
const paymentLabel = (method) => method === 'sumup_manual' ? 'SumUp (manuell bestätigt)' : 'Bar';

function confirmSumUpPayment(amount = null) {
  const amountText = Number.isFinite(amount) && amount > 0
    ? `SumUp-Zahlung: ${money(amount)}`
    : 'SumUp-Zahlung: Betrag bitte direkt in der SumUp-App oder am Terminal eingeben.';
  return window.confirm(
    `${amountText}\n\n` +
    'Bitte führe die Kartenzahlung jetzt in der SumUp-App oder am SumUp-Terminal durch.\n\n' +
    'Klicke nur auf „OK“, wenn SumUp die Zahlung als erfolgreich angezeigt hat.\n' +
    'Bei Abbruch oder Fehler klicke auf „Abbrechen“. '
  );
}

function initSales() {
  kiosk = data['content/kiosk.json']?.c || { products: [], sales: [] };
  kiosk.products = Array.isArray(kiosk.products) ? kiosk.products : [];
  kiosk.sales = Array.isArray(kiosk.sales) ? kiosk.sales : [];
  reservations = data['content/reservations.json']?.c?.reservations || [];
  fillEventSelects();
  renderPos(); renderProductEditor(); renderSales(); renderReservations(); renderToday();
}

function activeEvents() { return events.filter((event) => !event.past); }
function fillEventSelects() {
  const options = activeEvents().map((event) => `<option value="${escHtml(event.title)}">${escHtml(event.title)}${event.date ? ` — ${escHtml(event.date)}` : ''}</option>`).join('') || '<option value="">Keine kommende Vorstellung</option>';
  ['pos-event', 'walkin-event', 'today-event'].forEach((id) => { const select = document.getElementById(id); if (select) select.innerHTML = options; });
}

function renderPos() {
  const products = document.getElementById('product-grid');
  if (!products) return;
  const categories = ['Alle', ...new Set(kiosk.products.map((product) => product.category || 'Sonstiges'))];
  const tabs = document.getElementById('category-tabs');
  if (tabs) tabs.innerHTML = categories.map((category) => `<button class="category-tab ${category === activeCategory ? 'on' : ''}" onclick="setCategory('${escHtml(category)}')">${escHtml(category)}</button>`).join('');
  const visibleProducts = activeCategory === 'Alle' ? kiosk.products : kiosk.products.filter((product) => (product.category || 'Sonstiges') === activeCategory);
  products.innerHTML = visibleProducts.length ? visibleProducts.map((product) => {
    const out = product.stock !== '' && Number(product.stock) <= 0;
    return `<button class="product-btn" onclick="addToCart('${escHtml(product.id)}')" ${out ? 'disabled' : ''}><strong>${escHtml(product.name)}</strong><small>${money(product.price)} · ${product.stock === '' ? 'unbegrenzt' : `${product.stock} vorrätig`}</small></button>`;
  }).join('') : '<p class="hint">Lege zuerst Produkte an.</p>';
  const list = document.getElementById('cart-list');
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  list.innerHTML = cart.length ? cart.map((item, index) => `<div class="cart-row"><span>${escHtml(item.name)} × ${item.quantity}</span><span>${money(item.price * item.quantity)} <button onclick="removeCartItem(${index})" aria-label="Entfernen">×</button></span></div>`).join('') : '<p class="hint">Noch keine Artikel gewählt.</p>';
  document.getElementById('cart-total').textContent = money(total);
}
function setCategory(category) { activeCategory = category; renderPos(); }

function addToCart(id) {
  const product = kiosk.products.find((item) => item.id === id);
  if (!product || (product.stock !== '' && Number(product.stock) <= 0)) return;
  const item = cart.find((entry) => entry.id === id);
  if (item) { if (product.stock === '' || item.quantity < Number(product.stock)) item.quantity += 1; }
  else cart.push({ id: product.id, name: product.name, price: Number(product.price), quantity: 1 });
  renderPos();
}
function removeCartItem(index) { cart.splice(index, 1); renderPos(); }
function clearCart() { cart = []; renderPos(); }

async function saveRemote(path, value, message) {
  const latest = await loadFile(path);
  const ok = await ghPut(path, JSON.stringify(value, null, 2), latest.sha);
  if (ok) data[path] = { c: value, sha: latest.sha };
  return ok;
}

async function finishSale() {
  if (!cart.length) return toast('Bitte mindestens einen Artikel auswählen.', 'err');
  for (const item of cart) {
    const product = kiosk.products.find((entry) => entry.id === item.id);
    if (!product || (product.stock !== '' && Number(product.stock) < item.quantity)) return toast(`${item.name} ist nicht ausreichend vorrätig.`, 'err');
  }
  const paymentMethod = document.getElementById('pos-payment').value;
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (paymentMethod === 'sumup_manual' && !confirmSumUpPayment(total)) return toast('SumUp-Zahlung nicht als Verkauf gespeichert.', 'err');
  cart.forEach((item) => { const product = kiosk.products.find((entry) => entry.id === item.id); if (product.stock !== '') product.stock = Number(product.stock) - item.quantity; });
  kiosk.sales.unshift({ id: `POS-${Date.now()}`, eventTitle: document.getElementById('pos-event').value, items: cart, paymentMethod, total, createdAt: new Date().toISOString() });
  if (!(await saveRemote('content/kiosk.json', kiosk, 'Kassenverkauf speichern'))) return toast('Verkauf konnte nicht gespeichert werden.', 'err');
  clearCart(); renderProductEditor(); renderSales(); toast('Verkauf gespeichert.', 'ok');
}

function renderProductEditor() {
  const host = document.getElementById('product-editor'); if (!host) return;
  host.innerHTML = kiosk.products.map((product, index) => `<div class="field-row"><div class="field"><label>Name</label><input value="${escHtml(product.name)}" oninput="kiosk.products[${index}].name=this.value"></div><div class="field"><label>Kategorie</label><input value="${escHtml(product.category || 'Sonstiges')}" oninput="kiosk.products[${index}].category=this.value"></div><div class="field"><label>Preis (€)</label><input type="number" min="0" step="0.01" value="${Number(product.price)}" oninput="kiosk.products[${index}].price=Number(this.value)"></div><div class="field"><label>Bestand</label><input type="number" min="0" value="${product.stock}" oninput="kiosk.products[${index}].stock=this.value===''?'':Number(this.value)"></div><div class="field"><label>&nbsp;</label><button class="mini-btn" onclick="deleteProduct(${index})">Entfernen</button></div></div>`).join('');
}
function addProduct() { kiosk.products.push({ id: `product-${Date.now()}`, name: 'Neues Produkt', category: 'Sonstiges', price: 0, stock: 0 }); renderProductEditor(); }
function deleteProduct(index) { kiosk.products.splice(index, 1); renderProductEditor(); renderPos(); }
async function saveProducts() { if (await saveRemote('content/kiosk.json', kiosk, 'Produktkatalog speichern')) { renderPos(); toast('Produkte gespeichert.', 'ok'); } else toast('Produkte konnten nicht gespeichert werden.', 'err'); }

function renderSales() {
  const list = document.getElementById('sales-list'); if (!list) return;
  list.innerHTML = kiosk.sales.slice(0, 30).map((sale) => `<tr><td>${new Date(sale.createdAt).toLocaleString('de-DE')}</td><td>${escHtml(sale.eventTitle)}</td><td>${sale.items.map((item) => `${escHtml(item.name)} × ${item.quantity}`).join(', ')}</td><td>${paymentLabel(sale.paymentMethod)}</td><td>${money(sale.total)}</td></tr>`).join('') || '<tr><td colspan="5">Noch keine Verkäufe.</td></tr>';
}

function renderReservations() {
  const list = document.getElementById('reservations-list'); if (!list) return;
  const query = (document.getElementById('reservation-search')?.value || '').toLowerCase();
  const rows = reservations.filter((reservation) => [reservation.name, reservation.email, reservation.id, reservation.eventTitle].join(' ').toLowerCase().includes(query));
  list.innerHTML = rows.map((reservation) => {
    const amount = Number(reservation.ticketPrice || 0) * Number(reservation.quantity || 0);
    const cancelled = reservation.status === 'cancelled';
    return `<tr><td><strong>${escHtml(reservation.name)}</strong><br>${escHtml(reservation.email || '')}<br><small>${escHtml(reservation.id)}</small></td><td>${escHtml(reservation.eventTitle)}<br><small>${escHtml(reservation.eventDate || '')}</small></td><td>${reservation.quantity}<br><small>${money(amount)}</small></td><td><span class="status ${reservation.paymentStatus === 'paid' ? 'paid' : 'open'}">${cancelled ? 'Storniert' : reservation.type === 'waitlist' ? 'Warteliste' : reservation.paymentStatus === 'paid' ? `Bezahlt (${paymentLabel(reservation.paymentMethod)})` : 'Offen'}</span>${reservation.checkedIn ? '<br><span class="status paid">Eingelassen</span>' : ''}</td><td>${!cancelled && reservation.type !== 'waitlist' && reservation.paymentStatus !== 'paid' ? `<button class="mini-btn" onclick="payReservation('${escHtml(reservation.id)}','cash')">Bar bezahlen</button> <button class="mini-btn" onclick="payReservation('${escHtml(reservation.id)}','sumup_manual')">SumUp bestätigen</button>` : ''} ${!cancelled && reservation.type !== 'waitlist' && !reservation.checkedIn ? `<button class="mini-btn" onclick="checkInReservation('${escHtml(reservation.id)}')">Einlassen</button>` : ''} ${!cancelled ? `<button class="mini-btn" onclick="cancelReservation('${escHtml(reservation.id)}')">Stornieren</button>` : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="5">Keine Reservierungen gefunden.</td></tr>';
}

async function saveReservations() {
  const ok = await saveRemote('content/reservations.json', { reservations }, 'Ticketstatus aktualisieren');
  if (ok) { renderReservations(); renderToday(); toast('Ticketstatus gespeichert.', 'ok'); }
  else toast('Ticketstatus konnte nicht gespeichert werden.', 'err');
  return ok;
}
function payReservation(id, method) {
  const reservation = reservations.find((entry) => entry.id === id);
  if (!reservation) return;
  const amount = Number(reservation.ticketPrice || 0) * Number(reservation.quantity || 0);
  if (method === 'sumup_manual' && !confirmSumUpPayment(amount)) return toast('SumUp-Zahlung nicht als bezahlt gespeichert.', 'err');
  reservation.paymentStatus = 'paid'; reservation.paymentMethod = method; reservation.paidAt = new Date().toISOString(); saveReservations();
}
function checkInReservation(id) { const reservation = reservations.find((entry) => entry.id === id); if (!reservation) return; reservation.checkedIn = true; reservation.checkedInAt = new Date().toISOString(); saveReservations(); }

async function cancelReservation(id) {
  const reservation = reservations.find((entry) => entry.id === id);
  if (!reservation || !window.confirm(`Reservierung von ${reservation.name} wirklich stornieren?`)) return;
  reservation.status = 'cancelled'; reservation.cancelledAt = new Date().toISOString();
  const event = events.find((item) => item.title === reservation.eventTitle);
  if (event && reservation.type !== 'waitlist') {
    event.reserved = Math.max(0, Number(event.reserved || 0) - Number(reservation.quantity || 0));
    const waiting = reservations.find((item) => item.eventTitle === event.title && item.type === 'waitlist' && item.status !== 'cancelled' && Number(item.quantity) <= Number(event.capacity || 0) - Number(event.reserved || 0));
    if (waiting) { waiting.type = 'reservation'; waiting.promotedAt = new Date().toISOString(); event.reserved += Number(waiting.quantity); }
  }
  const [a, b] = await Promise.all([saveReservations(), saveRemote('content/events.json', { events }, 'Plätze und Warteliste aktualisieren')]);
  if (a && b) toast('Storno gespeichert; Warteliste wurde geprüft.', 'ok');
}

async function createWalkIn() {
  const name = document.getElementById('walkin-name').value.trim(); const eventTitle = document.getElementById('walkin-event').value; const quantity = Number(document.getElementById('walkin-qty').value);
  if (!name || !eventTitle || !Number.isInteger(quantity) || quantity < 1) return toast('Bitte Name, Vorstellung und Anzahl angeben.', 'err');
  const event = events.find((item) => item.title === eventTitle);
  const free = Number(event?.capacity || 0) - Number(event?.reserved || 0);
  if (!event || quantity > free) return toast('Für diese Vorstellung sind nicht genug Plätze frei.', 'err');
  const ticketPrice = Number(event.ticket_price || 0); const paymentMethod = document.getElementById('walkin-payment').value;
  if (paymentMethod === 'sumup_manual' && !confirmSumUpPayment(ticketPrice * quantity)) return toast('SumUp-Zahlung nicht als Ticket gespeichert.', 'err');
  reservations.unshift({ id: `WSP-VORORT-${Date.now()}`, name, email: document.getElementById('walkin-email').value.trim(), eventTitle, quantity, ticketPrice, type: 'walkin', paymentStatus: 'paid', paymentMethod, checkedIn: true, createdAt: new Date().toISOString(), paidAt: new Date().toISOString() });
  event.reserved = Number(event.reserved || 0) + quantity;
  const savedReservations = await saveReservations(); const savedEvents = await saveRemote('content/events.json', { events }, 'Vor-Ort-Tickets speichern');
  if (!savedReservations || !savedEvents) return toast('Ticket konnte nicht vollständig gespeichert werden.', 'err');
  document.getElementById('walkin-name').value = ''; document.getElementById('walkin-email').value = ''; document.getElementById('walkin-qty').value = 1; renderToday();
}

function renderToday() {
  const select = document.getElementById('today-event'); if (!select) return;
  if (!select.options.length) fillEventSelects();
  const eventTitle = select.value || document.getElementById('pos-event')?.value || '';
  const relevant = reservations.filter((item) => item.eventTitle === eventTitle && item.status !== 'cancelled');
  const sales = kiosk.sales.filter((sale) => sale.eventTitle === eventTitle);
  const total = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const cash = sales.filter((sale) => sale.paymentMethod === 'cash').reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const sumup = sales.filter((sale) => sale.paymentMethod === 'sumup_manual').reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  set('today-event-title', eventTitle || 'Keine kommende Vorstellung gewählt.');
  set('today-reserved', relevant.filter((item) => item.type !== 'waitlist').reduce((sum, item) => sum + Number(item.quantity || 0), 0));
  set('today-open', relevant.filter((item) => item.type !== 'waitlist' && item.paymentStatus !== 'paid').reduce((sum, item) => sum + Number(item.quantity || 0), 0));
  set('today-checkin', relevant.filter((item) => item.checkedIn).reduce((sum, item) => sum + Number(item.quantity || 0), 0));
  set('today-sales', money(total)); set('close-cash', money(cash)); set('close-sumup', money(sumup)); set('close-total', money(total)); set('close-count', sales.length);
  const stock = document.getElementById('closing-stock');
  if (stock) stock.innerHTML = kiosk.products.map((item) => `<tr><td>${escHtml(item.name)}</td><td>${escHtml(item.category || 'Sonstiges')}</td><td>${item.stock === '' ? 'unbegrenzt' : item.stock}</td></tr>`).join('') || '<tr><td colspan="3">Keine Produkte vorhanden.</td></tr>';
}

async function startScanner() {
  const result = document.getElementById('scanner-result'); const video = document.getElementById('qr-video');
  if (!('BarcodeDetector' in window)) { result.textContent = 'Dieser Browser unterstützt den QR-Scanner nicht. Bitte Reservierungs-ID in die Suche eingeben.'; return; }
  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scannerStream; video.style.display = 'block'; await video.play();
    const detector = new BarcodeDetector({ formats: ['qr_code'] }); result.textContent = 'Kamera aktiv – QR-Code vor die Kamera halten.';
    scannerTimer = setInterval(async () => {
      const codes = await detector.detect(video); if (!codes.length) return;
      const match = codes[0].rawValue.match(/\|([^|]+)$/); const id = match?.[1] || codes[0].rawValue;
      const input = document.getElementById('reservation-search'); input.value = id; renderReservations();
      const reservation = reservations.find((item) => item.id === id); result.textContent = reservation ? `${reservation.name}: ${reservation.checkedIn ? 'bereits eingelassen' : 'gefunden'}.` : 'Code gelesen, aber keine Reservierung gefunden.';
      stopScanner();
    }, 500);
  } catch { result.textContent = 'Kamera konnte nicht gestartet werden. Bitte Berechtigung erlauben oder die ID manuell suchen.'; }
}
function stopScanner() { if (scannerTimer) clearInterval(scannerTimer); scannerTimer = null; if (scannerStream) scannerStream.getTracks().forEach((track) => track.stop()); scannerStream = null; const video = document.getElementById('qr-video'); if (video) { video.pause(); video.srcObject = null; video.style.display = 'none'; } }

function initGallery() { gallery = data['content/gallery.json']?.c?.items || []; renderGalleryEditor(); }
function renderGalleryEditor() { const host = document.getElementById('gallery-editor'); if (!host) return; host.innerHTML = gallery.map((item, index) => `<div class="field-row"><div class="field"><label>Bild-URL</label><input type="url" value="${escHtml(item.image)}" oninput="gallery[${index}].image=this.value"></div><div class="field"><label>Alternativtext</label><input value="${escHtml(item.alt)}" oninput="gallery[${index}].alt=this.value"></div><div class="field"><label>&nbsp;</label><button class="mini-btn" onclick="gallery.splice(${index},1);renderGalleryEditor()">Entfernen</button></div></div>`).join(''); }
function addGalleryItem() { gallery.push({ image: '', alt: 'Jugendensemble WSP bei Probe oder Aufführung' }); renderGalleryEditor(); }
async function saveGallery() { if (await saveRemote('content/gallery.json', { items: gallery }, 'Galerie aktualisieren')) toast('Galerie gespeichert.', 'ok'); else toast('Galerie konnte nicht gespeichert werden.', 'err'); }
