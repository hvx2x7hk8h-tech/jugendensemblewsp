let kiosk = { products: [], sales: [] };
let reservations = [];
let cart = [];

const money = (value) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));
const escHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
const paymentLabel = (method) => method === 'card' ? 'Karte' : 'Bar';

function initSales() {
  kiosk = data['content/kiosk.json']?.c || { products: [], sales: [] };
  kiosk.products = Array.isArray(kiosk.products) ? kiosk.products : [];
  kiosk.sales = Array.isArray(kiosk.sales) ? kiosk.sales : [];
  reservations = data['content/reservations.json']?.c?.reservations || [];
  fillEventSelects();
  renderPos(); renderProductEditor(); renderSales(); renderReservations();
}

function activeEvents() { return events.filter((event) => !event.past); }
function fillEventSelects() {
  const options = activeEvents().map((event) => `<option value="${escHtml(event.title)}">${escHtml(event.title)}${event.date ? ` — ${escHtml(event.date)}` : ''}</option>`).join('') || '<option value="">Keine kommende Vorstellung</option>';
  ['pos-event', 'walkin-event'].forEach((id) => { const select = document.getElementById(id); if (select) select.innerHTML = options; });
}

function renderPos() {
  const products = document.getElementById('product-grid');
  if (!products) return;
  products.innerHTML = kiosk.products.length ? kiosk.products.map((product) => {
    const out = product.stock !== '' && Number(product.stock) <= 0;
    return `<button class="product-btn" onclick="addToCart('${escHtml(product.id)}')" ${out ? 'disabled' : ''}><strong>${escHtml(product.name)}</strong><small>${money(product.price)} · ${product.stock === '' ? 'unbegrenzt' : `${product.stock} vorrätig`}</small></button>`;
  }).join('') : '<p class="hint">Lege zuerst Produkte an.</p>';
  const list = document.getElementById('cart-list');
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  list.innerHTML = cart.length ? cart.map((item, index) => `<div class="cart-row"><span>${escHtml(item.name)} × ${item.quantity}</span><span>${money(item.price * item.quantity)} <button onclick="removeCartItem(${index})" aria-label="Entfernen">×</button></span></div>`).join('') : '<p class="hint">Noch keine Artikel gewählt.</p>';
  document.getElementById('cart-total').textContent = money(total);
}

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
  cart.forEach((item) => { const product = kiosk.products.find((entry) => entry.id === item.id); if (product.stock !== '') product.stock = Number(product.stock) - item.quantity; });
  kiosk.sales.unshift({ id: `POS-${Date.now()}`, eventTitle: document.getElementById('pos-event').value, items: cart, paymentMethod: document.getElementById('pos-payment').value, total: cart.reduce((sum, item) => sum + item.price * item.quantity, 0), createdAt: new Date().toISOString() });
  if (!(await saveRemote('content/kiosk.json', kiosk, 'Kassenverkauf speichern'))) return toast('Verkauf konnte nicht gespeichert werden.', 'err');
  clearCart(); renderProductEditor(); renderSales(); toast('Verkauf gespeichert.', 'ok');
}

function renderProductEditor() {
  const host = document.getElementById('product-editor'); if (!host) return;
  host.innerHTML = kiosk.products.map((product, index) => `<div class="field-row"><div class="field"><label>Name</label><input value="${escHtml(product.name)}" oninput="kiosk.products[${index}].name=this.value"></div><div class="field"><label>Preis (€)</label><input type="number" min="0" step="0.01" value="${Number(product.price)}" oninput="kiosk.products[${index}].price=Number(this.value)"></div><div class="field"><label>Bestand</label><input type="number" min="0" value="${product.stock}" oninput="kiosk.products[${index}].stock=this.value===''?'':Number(this.value)"></div><div class="field"><label>&nbsp;</label><button class="mini-btn" onclick="deleteProduct(${index})">Entfernen</button></div></div>`).join('');
}
function addProduct() { kiosk.products.push({ id: `product-${Date.now()}`, name: 'Neues Produkt', price: 0, stock: 0 }); renderProductEditor(); }
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
  list.innerHTML = rows.map((reservation) => `<tr><td><strong>${escHtml(reservation.name)}</strong><br>${escHtml(reservation.email || '')}<br><small>${escHtml(reservation.id)}</small></td><td>${escHtml(reservation.eventTitle)}<br><small>${escHtml(reservation.eventDate || '')}</small></td><td>${reservation.quantity}</td><td><span class="status ${reservation.paymentStatus === 'paid' ? 'paid' : 'open'}">${reservation.paymentStatus === 'paid' ? `Bezahlt (${paymentLabel(reservation.paymentMethod)})` : 'Offen'}</span>${reservation.checkedIn ? '<br><span class="status paid">Eingelassen</span>' : ''}</td><td>${reservation.paymentStatus !== 'paid' ? `<button class="mini-btn" onclick="payReservation('${escHtml(reservation.id)}','cash')">Bar bezahlen</button> <button class="mini-btn" onclick="payReservation('${escHtml(reservation.id)}','card')">Karte bezahlen</button>` : ''} ${!reservation.checkedIn ? `<button class="mini-btn" onclick="checkInReservation('${escHtml(reservation.id)}')">Einlassen</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5">Keine Reservierungen gefunden.</td></tr>';
}

async function saveReservations() {
  if (await saveRemote('content/reservations.json', { reservations }, 'Ticketstatus aktualisieren')) { renderReservations(); toast('Ticketstatus gespeichert.', 'ok'); }
  else toast('Ticketstatus konnte nicht gespeichert werden.', 'err');
}
function payReservation(id, method) { const reservation = reservations.find((entry) => entry.id === id); if (!reservation) return; reservation.paymentStatus = 'paid'; reservation.paymentMethod = method; reservation.paidAt = new Date().toISOString(); saveReservations(); }
function checkInReservation(id) { const reservation = reservations.find((entry) => entry.id === id); if (!reservation) return; reservation.checkedIn = true; reservation.checkedInAt = new Date().toISOString(); saveReservations(); }

function createWalkIn() {
  const name = document.getElementById('walkin-name').value.trim(); const eventTitle = document.getElementById('walkin-event').value; const quantity = Number(document.getElementById('walkin-qty').value);
  if (!name || !eventTitle || !Number.isInteger(quantity) || quantity < 1) return toast('Bitte Name, Vorstellung und Anzahl angeben.', 'err');
  reservations.unshift({ id: `WSP-VORORT-${Date.now()}`, name, email: document.getElementById('walkin-email').value.trim(), eventTitle, quantity, type: 'walkin', paymentStatus: 'paid', paymentMethod: document.getElementById('walkin-payment').value, checkedIn: true, createdAt: new Date().toISOString(), paidAt: new Date().toISOString() });
  saveReservations(); document.getElementById('walkin-name').value = ''; document.getElementById('walkin-email').value = ''; document.getElementById('walkin-qty').value = 1;
}
