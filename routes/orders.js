const express = require('express');
const QRCode = require('qrcode');
const db = require('../database/db');

const router = express.Router();

const ALLOWED_STATUS = ['pending', 'preparing', 'ready', 'completed', 'expired'];

class BadRequest extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function getOrder(id) {
  const order = db.prepare(
    'SELECT id, order_number, status, total, created_at, updated_at FROM orders WHERE id = ?'
  ).get(id);
  if (!order) return null;

  order.items = db.prepare(
    `SELECT oi.product_id, p.name, oi.quantity, oi.price, oi.subtotal
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ? ORDER BY oi.id`
  ).all(id);
  return order;
}

const placeOrder = db.transaction((items) => {
  // Precios siempre desde la BD: el cliente nunca decide cuánto cuesta un producto.
  const product = db.prepare('SELECT id, price FROM products WHERE id = ? AND available = 1');
  const lines = items.map((item) => {
    const p = product.get(item.product_id);
    if (!p) throw new BadRequest(`Producto no disponible: ${item.product_id}`);
    const subtotal = Math.round(p.price * item.quantity * 100) / 100;
    return { id: p.id, price: p.price, quantity: item.quantity, subtotal };
  });

  const nextNumber = db.prepare('SELECT COALESCE(MAX(order_number), 0) + 1 AS n FROM orders').get().n;
  const total = Math.round(lines.reduce((sum, line) => sum + line.subtotal, 0) * 100) / 100;

  const result = db.prepare(
    "INSERT INTO orders (order_number, status, total) VALUES (?, 'pending', ?)"
  ).run(nextNumber, total);
  const orderId = Number(result.lastInsertRowid);

  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)'
  );
  for (const line of lines) {
    insertItem.run(orderId, line.id, line.quantity, line.price, line.subtotal);
  }
  return orderId;
});

router.post('/', (req, res, next) => {
  try {
    const items = req.body && req.body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
      throw new BadRequest('El pedido debe incluir entre 1 y 50 productos');
    }
    for (const item of items) {
      if (!item || !Number.isInteger(item.product_id) ||
          !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new BadRequest('Cada producto necesita un ID válido y una cantidad entre 1 y 99');
      }
    }

    const id = placeOrder(items);
    const order = getOrder(id);
    req.app.get('io').to('admin').emit('new-order', order);
    res.status(201).json(order);
  } catch (err) {
    next(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    const orders = db.prepare(
      `SELECT id, order_number, status, total, created_at, updated_at FROM orders
       ORDER BY CASE status WHEN 'completed' THEN 1 WHEN 'expired' THEN 1 ELSE 0 END,
                CASE status WHEN 'ready' THEN 0 WHEN 'preparing' THEN 1 ELSE 2 END,
                id DESC`
    ).all();
    const allItems = db.prepare(
      `SELECT oi.order_id, oi.product_id, p.name, oi.quantity, oi.price, oi.subtotal
       FROM order_items oi JOIN products p ON p.id = oi.product_id
       ORDER BY oi.order_id, oi.id`
    ).all();
    const byOrder = new Map();
    for (const item of allItems) {
      if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, []);
      const { order_id, ...line } = item;
      byOrder.get(order_id).push(line);
    }
    res.json(orders.map((o) => ({ ...o, items: byOrder.get(o.id) || [] })));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/qr', async (req, res, next) => {
  try {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });

    const payload = JSON.stringify({
      orderId: order.id,
      orderNumber: order.order_number,
      timestamp: order.created_at,
    });
    const png = await QRCode.toBuffer(payload, {
      type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M',
      color: { dark: '#2A1F1A', light: '#EAE3D6' },
    });
    res.type('png').send(png);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const order = getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/status', (req, res, next) => {
  try {
    const status = req.body && req.body.status;
    if (!ALLOWED_STATUS.includes(status)) {
      throw new BadRequest(`Estado inválido. Use: ${ALLOWED_STATUS.join(', ')}`);
    }
    if (!getOrder(req.params.id)) return res.status(404).json({ error: 'Orden no encontrada' });

    db.prepare("UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(status, req.params.id);
    const order = getOrder(req.params.id);
    req.app.get('io').emit('order-updated', {
      id: order.id, order_number: order.order_number, status: order.status,
    });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const result = db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: 'Orden no encontrada' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Las órdenes pendientes abandonadas se cierran solas a los 30 minutos.
function expireStaleOrders() {
  const expired = db.prepare(
    `UPDATE orders SET status = 'expired', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending' AND created_at < datetime('now', '-30 minutes')
     RETURNING id, order_number`
  ).all();
  return expired;
}

module.exports = { router, expireStaleOrders, getOrder };
