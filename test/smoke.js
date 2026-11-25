const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 38000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function api(url, options) {
  const res = await fetch(base + url, options);
  const body = res.status === 204 ? null : await res.json();
  return { res, body };
}

async function main() {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { ready = (await api('/api/health')).res.ok; } catch { await sleep(100); }
  }
  assert.ok(ready, 'el servidor no arrancó');

  for (const page of ['/', '/admin', '/js/client.js', '/js/admin.js', '/css/styles.css', '/vendor/html5-qrcode.min.js']) {
    assert.equal((await fetch(base + page)).status, 200, `${page} debe servirse`);
  }

  const products = (await api('/api/products')).body;
  assert.equal(products.length, 10, 'deben sembrarse 10 productos');
  assert.ok(products.every((p) => p.price >= 0 && p.category && p.image));
  for (const product of products) {
    const img = await fetch(base + product.image);
    assert.equal(img.status, 200, `falta la imagen de ${product.name}`);
    assert.match(img.headers.get('content-type'), /image\/png/);
  }

  const bad = await api('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"items":[]}',
  });
  assert.equal(bad.res.status, 400, 'un pedido vacío debe rechazarse');

  const created = await api('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ product_id: products[0].id, quantity: 2 },
                                   { product_id: products[6].id, quantity: 1 }] }),
  });
  assert.equal(created.res.status, 201);
  const order = created.body;
  assert.equal(order.total, Math.round((products[0].price * 2 + products[6].price) * 100) / 100);
  assert.equal(order.items.length, 2);
  assert.ok(Number.isInteger(order.order_number));
  assert.equal(order.status, 'pending');

  const detail = (await api(`/api/orders/${order.id}`)).body;
  assert.equal(detail.order_number, order.order_number);

  const qr = await fetch(`${base}/api/orders/${order.id}/qr`);
  assert.match(qr.headers.get('content-type'), /image\/png/);
  assert.ok((await qr.arrayBuffer()).byteLength > 500, 'el QR debe generar una imagen');

  const updated = await api(`/api/orders/${order.id}/status`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'ready' }),
  });
  assert.equal(updated.body.status, 'ready');

  const list = (await api('/api/orders')).body;
  assert.ok(list.some((o) => o.id === order.id && o.status === 'ready'));

  const deleted = await api(`/api/orders/${order.id}`, { method: 'DELETE' });
  assert.equal(deleted.res.status, 204);
  assert.equal((await api(`/api/orders/${order.id}`)).res.status, 404);

  console.log('✓ SQL, API, validación, total, QR, estados y borrado: OK');
}

main().catch((err) => {
  console.error('✗ Smoke test falló:', err.message);
  process.exitCode = 1;
}).finally(() => server.kill());
