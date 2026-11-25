(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => `$${Number(n).toFixed(2)}`;
  const socket = io();

  const LABELS = {
    pending: 'Pendiente', preparing: 'En preparación', ready: 'Lista',
    completed: 'Completada', expired: 'Expirada',
  };
  const ACTIONS = [['preparing', 'En Preparación'], ['ready', 'Lista'], ['completed', 'Completada']];
  const CLOSED = ['completed', 'expired'];

  const orders = new Map();
  let scanner = null;
  let modalOrderId = null;
  let bannerTimer;
  let lastScan = { text: '', at: 0 };

  function timeAgo(created) {
    const date = new Date(String(created).replace(' ', 'T') + 'Z');
    if (Number.isNaN(date.getTime())) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return 'hace <1 min';
    if (minutes < 60) return `hace ${minutes} min`;
    return `hace ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  function clockTime(created) {
    const date = new Date(String(created).replace(' ', 'T') + 'Z');
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }

  function statusButtons(order) {
    return ACTIONS.map(([status, label]) =>
      `<button type="button" data-status="${status}" data-id="${order.id}"
        class="${order.status === status ? 'current' : ''}">${label}</button>`).join('');
  }

  function card(order) {
    const items = order.items.map((item) =>
      `<li><span>${esc(item.name)} ×${item.quantity}</span><b>${money(item.subtotal)}</b></li>`).join('');
    return `<article class="order-card status-${order.status}">
      <div class="order-top">
        <span class="order-num">#${order.order_number}</span>
        <span class="status-pill status-${order.status}">${LABELS[order.status] || order.status}</span>
      </div>
      <div class="order-meta">
        <span data-created="${esc(order.created_at)}">${timeAgo(order.created_at)}</span>
        <span>${clockTime(order.created_at)}</span>
      </div>
      <ul class="order-items">${items}</ul>
      <div class="order-total"><span>Total</span><span>${money(order.total)}</span></div>
      <div class="status-actions">${statusButtons(order)}</div>
    </article>`;
  }

  function render() {
    const all = [...orders.values()].sort((a, b) => b.order_number - a.order_number);
    const active = all.filter((o) => !CLOSED.includes(o.status));
    const history = all.filter((o) => CLOSED.includes(o.status));

    $('active-count').textContent = String(active.length);
    $('history-count').textContent = String(history.length);
    $('active-orders').innerHTML = active.length ? active.map(card).join('')
      : '<div class="empty-state">Sin órdenes activas. Las nuevas aparecerán aquí automáticamente.</div>';
    $('history-orders').innerHTML = history.length ? history.map(card).join('')
      : '<div class="empty-state">Todavía no hay órdenes finalizadas.</div>';

    if (modalOrderId !== null) renderDetail();
  }

  function renderDetail() {
    const order = orders.get(modalOrderId);
    if (!order) { $('order-modal').hidden = true; modalOrderId = null; return; }
    $('detail-number').textContent = `#${order.order_number}`;
    $('detail-status').textContent = LABELS[order.status] || order.status;
    $('detail-status').className = `status-pill status-${order.status}`;
    $('detail-items').innerHTML = order.items.map((item) =>
      `<tr><td>${esc(item.name)} ×${item.quantity}</td><td>${money(item.subtotal)}</td></tr>`).join('');
    $('detail-total').textContent = money(order.total);
    $('detail-actions').innerHTML = statusButtons(order);
  }

  function openDetail(order) {
    modalOrderId = order.id;
    renderDetail();
    $('order-modal').hidden = false;
  }

  function notify(order) {
    const banner = $('new-order-banner');
    banner.textContent = `Nueva orden #${order.order_number}`;
    banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { banner.hidden = true; }, 4000);

    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      osc.onended = () => ctx.close();
    } catch { /* El navegador puede bloquear el audio hasta una interacción. */ }
  }

  async function loadOrders() {
    try {
      const res = await fetch('/api/orders');
      if (!res.ok) throw new Error('No se pudieron cargar las órdenes');
      const list = await res.json();
      orders.clear();
      for (const order of list) orders.set(order.id, order);
      render();
    } catch (err) {
      $('scan-status').textContent = err.message;
    }
  }

  async function changeStatus(id, status) {
    try {
      const res = await fetch(`/api/orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo actualizar la orden');
      orders.set(data.id, data);
      render();
    } catch (err) {
      $('scan-status').textContent = `Error: ${err.message}`;
    }
  }

  async function findOrder(text) {
    let id = null;
    let number = null;
    try {
      const data = JSON.parse(text);
      id = Number(data.orderId) || null;
      number = Number(data.orderNumber) || null;
    } catch {
      const trimmed = String(text).trim();
      if (/^\d+$/.test(trimmed)) number = Number(trimmed);
    }

    let order = id ? orders.get(id) : null;
    if (!order && number) order = [...orders.values()].find((o) => o.order_number === number);
    if (!order && id) {
      try {
        const res = await fetch(`/api/orders/${id}`);
        if (res.ok) { order = await res.json(); orders.set(order.id, order); }
      } catch { /* Se reporta como QR no válido más abajo. */ }
    }
    return order || null;
  }

  async function handleScan(text) {
    if (lastScan.text === text && Date.now() - lastScan.at < 4000) return;
    lastScan = { text, at: Date.now() };
    const order = await findOrder(text);
    if (order) {
      $('scan-status').textContent = `Orden #${order.order_number} encontrada`;
      openDetail(order);
    } else {
      $('scan-status').textContent = 'QR no reconocido. Prueba escribiendo el número de orden.';
    }
  }

  async function startScanner() {
    if (!window.Html5Qrcode) {
      $('scan-status').textContent = 'El escáner no está disponible. Usa el número de orden.';
      return;
    }
    try {
      scanner = new Html5Qrcode('reader', { verbose: false });
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => {
          const side = Math.min(260, w - 40, h - 40);
          return { width: Math.max(120, side), height: Math.max(120, side) };
        } },
        (text) => handleScan(text),
        () => {}
      );
      $('start-scan').disabled = true;
      $('stop-scan').disabled = false;
      $('scan-status').textContent = 'Cámara activa. Apunta al QR del cliente.';
    } catch (err) {
      scanner = null;
      $('scan-status').textContent = `No se pudo activar la cámara: ${err.message || err}. Usa el número de orden.`;
    }
  }

  async function stopScanner() {
    if (!scanner) return;
    try { await scanner.stop(); await scanner.clear(); } catch { /* Cámara ya detenida. */ }
    scanner = null;
    $('start-scan').disabled = false;
    $('stop-scan').disabled = true;
    $('scan-status').textContent = 'Cámara detenida.';
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-status]');
    if (button) changeStatus(button.dataset.id, button.dataset.status);
  });

  $('close-detail').addEventListener('click', () => {
    $('order-modal').hidden = true;
    modalOrderId = null;
  });
  $('order-modal').addEventListener('click', (event) => {
    if (event.target === $('order-modal')) {
      $('order-modal').hidden = true;
      modalOrderId = null;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('order-modal').hidden) {
      $('order-modal').hidden = true;
      modalOrderId = null;
    }
  });

  $('manual-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const number = Number($('manual-order').value);
    if (!number) return;
    const order = [...orders.values()].find((o) => o.order_number === number || o.id === number);
    if (order) openDetail(order);
    else $('scan-status').textContent = `No existe la orden #${number}`;
  });

  $('start-scan').addEventListener('click', startScanner);
  $('stop-scan').addEventListener('click', stopScanner);

  socket.on('connect', () => {
    $('conn').className = 'conn-badge';
    $('conn').textContent = 'En vivo';
    socket.emit('join-admin');
    loadOrders();
  });
  socket.on('disconnect', () => {
    $('conn').className = 'conn-badge offline';
    $('conn').textContent = 'Sin conexión';
  });
  socket.on('new-order', (order) => {
    orders.set(order.id, order);
    render();
    notify(order);
  });
  socket.on('order-updated', async (update) => {
    const current = orders.get(update.id);
    if (current) {
      orders.set(current.id, { ...current, ...update });
      render();
    } else {
      await loadOrders();
    }
  });

  setInterval(() => {
    document.querySelectorAll('[data-created]').forEach((el) => {
      el.textContent = timeAgo(el.dataset.created);
    });
  }, 30000);

  loadOrders();
})();
