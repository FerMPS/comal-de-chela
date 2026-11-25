const path = require('node:path');
const os = require('node:os');
const express = require('express');
const cors = require('cors');
const { createServer } = require('node:http');
const { Server } = require('socket.io');

const products = require('./routes/products');
const { router: orders, expireStaleOrders } = require('./routes/orders');

const app = express();
const server = createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT) || 3000;

app.set('io', io);
app.use(cors());
app.use(express.json({ limit: '32kb' }));

app.use('/api/products', products);
app.use('/api/orders', orders);
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Librería del escáner servida localmente: funciona sin internet en el puesto.
app.get('/vendor/html5-qrcode.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/html5-qrcode/html5-qrcode.min.js'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Error interno del servidor' : err.message });
});

io.on('connection', (socket) => {
  socket.on('join-admin', () => socket.join('admin'));
  socket.on('new-order', (data) => {
    if (data && Number.isInteger(data.orderId)) socket.emit('order-created', data);
  });
});

expireStaleOrders();
setInterval(() => {
  for (const order of expireStaleOrders()) {
    io.emit('order-updated', { ...order, status: 'expired' });
  }
}, 60_000).unref();

function lanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    const ip = (addresses || []).find((a) => a.family === 'IPv4' && !a.internal);
    if (ip) return ip.address;
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Comal de Chela listo:`);
  console.log(`  Menú:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin`);
  console.log(`  En el celular (misma WiFi): http://${lanAddress()}:${PORT}/`);
});
