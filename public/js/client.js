(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `$${Number(n).toFixed(2)}`;
  const socket = typeof io === 'function' ? io() : null;

  let products = [];
  let cart = loadCart();
  let currentOrder = null;
  let toastTimer;

  function loadCart() {
    try {
      const saved = JSON.parse(localStorage.getItem('comal-cart') || '{}');
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
      return Object.fromEntries(Object.entries(saved)
        .filter(([id, qty]) => Number.isInteger(+id) && Number.isInteger(qty) && qty > 0 && qty <= 99));
    } catch {
      return {};
    }
  }

  function saveCart() {
    try { localStorage.setItem('comal-cart', JSON.stringify(cart)); } catch { /*Storage lleno: el pedido sigue funcionando*/ }
  }

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  async function loadProducts() {
    $('menu').setAttribute('aria-busy', 'true');
    try {
      const res = await fetch('/api/products');
      if (!res.ok) throw new Error('No se pudo cargar el menú');
      products = await res.json();
      renderMenu();
    } catch (err) {
      $('menu').innerHTML = `<div class="menu-error"><p>${esc(err.message)}</p>
        <button class="secondary-button" id="retry-menu" type="button">Reintentar</button></div>`;
    } finally {
      $('menu').setAttribute('aria-busy', 'false');
    }
  }

  const plusIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  function renderMenu() {
    const groups = [
      { key: 'pupusa', title: 'Pupusas', sub: 'Calientes al comal, listas para ti' },
      { key: 'bebida', title: 'Bebidas', sub: 'Para acompañar tu pedido' },
    ];
    $('menu').innerHTML = groups.map((group) => {
      const cards = products.filter((p) => p.category === group.key).map((p) => `
        <article class="product-card">
          <img class="product-image" src="${esc(p.image || '')}" alt="${esc(p.name)}" loading="lazy">
          <div class="product-body">
            <div class="product-top">
              <div class="product-name">${esc(p.name)}</div>
              <div class="product-price">${money(p.price)}</div>
            </div>
            <p class="product-desc">${esc(p.description || '')}</p>
            <button class="primary-button add-button" type="button" data-add="${p.id}" aria-label="Agregar ${esc(p.name)}">
              ${plusIcon}<span>Agregar</span>
            </button>
          </div>
        </article>`).join('');
      return `<section>
        <div class="category-head">
          <h2>${group.title}</h2>
          <p>${group.sub}</p>
        </div>
        <div class="product-grid">${cards}</div>
      </section>`;
    }).join('');
  }

  function cartLines() {
    return Object.entries(cart).map(([id, qty]) => {
      const product = products.find((p) => p.id === Number(id));
      return product && { id: Number(id), name: product.name, price: product.price, qty };
    }).filter(Boolean);
  }

  function renderCart() {
    const lines = cartLines();
    const count = lines.reduce((n, line) => n + line.qty, 0);
    const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);

    $('fab-count').textContent = String(count);
    $('fab-total').textContent = money(total);
    $('cart-total').textContent = money(total);
    $('checkout').disabled = lines.length === 0 || $('checkout').dataset.loading === 'true';

    $('cart-items').innerHTML = lines.length ? lines.map((line) => `
      <div class="cart-line">
        <div>
          <div class="cart-line-name">${esc(line.name)}</div>
          <div class="cart-line-sub">${money(line.price)} c/u</div>
        </div>
        <div class="cart-line-total">${money(line.price * line.qty)}</div>
        <div class="qty-control" aria-label="Cantidad de ${esc(line.name)}">
          <button type="button" data-dec="${line.id}" aria-label="Quitar uno">−</button>
          <span>${line.qty}</span>
          <button type="button" data-inc="${line.id}" aria-label="Agregar uno">+</button>
        </div>
        <button class="icon-button" type="button" data-remove="${line.id}" aria-label="Eliminar ${esc(line.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>`).join('') : '<div class="cart-empty">Tu pedido está vacío. Agrega algo delicioso del menú.</div>';
  }

  function setQty(id, delta) {
    const next = (cart[id] || 0) + delta;
    if (next <= 0) delete cart[id];
    else if (next <= 99) cart[id] = next;
    saveCart();
    renderCart();
  }

  function openCart() {
    $('backdrop').hidden = false;
    $('cart').classList.add('is-open');
    $('cart').setAttribute('aria-hidden', 'false');
    $('cart-fab').setAttribute('aria-expanded', 'true');
    document.body.classList.add('cart-open');
  }

  function closeCart() {
    $('backdrop').hidden = true;
    $('cart').classList.remove('is-open');
    $('cart').setAttribute('aria-hidden', 'true');
    $('cart-fab').setAttribute('aria-expanded', 'false');
    document.body.classList.remove('cart-open');
  }

  const statusLabels = {
    pending: 'Esperando en el puesto',
    preparing: 'En preparación',
    ready: '¡Lista! Pásala a recoger',
    completed: 'Pedido completado',
    expired: 'Orden expirada',
  };

  function showStatus(status) {
    $('order-status').textContent = statusLabels[status] || statusLabels.pending;
    $('order-status').className = `status-pill status-${status}`;
  }

  function showConfirmation(order) {
    currentOrder = order;
    $('order-number').textContent = `#${order.order_number}`;
    showStatus('pending');

    const img = $('order-qr');
    const loading = document.querySelector('.qr-loading');
    img.hidden = true;
    loading.hidden = false;
    img.onload = () => { img.hidden = false; loading.hidden = true; };
    img.onerror = () => {
      loading.hidden = true;
      toast('No se pudo generar el QR. Muestra tu número en el puesto.');
    };
    img.src = `/api/orders/${order.id}/qr?t=${Date.now()}`;
    $('confirmation').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeConfirmation() {
    $('confirmation').hidden = true;
    currentOrder = null;
    document.body.style.overflow = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function checkout() {
    const items = cartLines().map((line) => ({ product_id: line.id, quantity: line.qty }));
    if (!items.length) return;

    const button = $('checkout');
    button.dataset.loading = 'true';
    button.disabled = true;
    button.textContent = 'Enviando pedido…';
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo enviar el pedido');

      cart = {};
      saveCart();
      renderCart();
      closeCart();
      showConfirmation(data);
      if (socket) socket.emit('new-order', { orderId: data.id, orderNumber: data.order_number });
    } catch (err) {
      toast(err.message);
    } finally {
      delete button.dataset.loading;
      button.textContent = 'Realizar pedido';
      renderCart();
    }
  }

  $('menu').addEventListener('click', (event) => {
    if (event.target.closest('#retry-menu')) return loadProducts();
    const add = event.target.closest('[data-add]');
    if (!add) return;
    const id = Number(add.dataset.add);
    setQty(id, 1);
    add.classList.remove('bump');
    void add.offsetWidth; // Reinicia la animación de feedback.
    add.classList.add('bump');
    toast('Agregado a tu pedido');
  });

  $('cart-items').addEventListener('click', (event) => {
    const inc = event.target.closest('[data-inc]');
    const dec = event.target.closest('[data-dec]');
    const remove = event.target.closest('[data-remove]');
    if (inc) setQty(Number(inc.dataset.inc), 1);
    else if (dec) setQty(Number(dec.dataset.dec), -1);
    else if (remove) { delete cart[Number(remove.dataset.remove)]; saveCart(); renderCart(); }
  });

  $('cart-fab').addEventListener('click', openCart);
  $('close-cart').addEventListener('click', closeCart);
  $('backdrop').addEventListener('click', closeCart);
  $('checkout').addEventListener('click', checkout);
  $('new-order').addEventListener('click', closeConfirmation);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('confirmation').hidden) closeConfirmation();
    else if ($('cart').classList.contains('is-open')) closeCart();
  });

  if (socket) {
    socket.on('order-created', () => toast('Tu orden ya está en el puesto'));
    socket.on('order-updated', (update) => {
      if (currentOrder && update && update.id === currentOrder.id) showStatus(update.status);
    });
  }

  renderCart();
  loadProducts();
})();
