const path = require('node:path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'comal.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('pupusa', 'bebida')),
    price REAL NOT NULL CHECK (price >= 0),
    description TEXT,
    available BOOLEAN DEFAULT 1,
    image TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number INTEGER UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'preparing', 'ready', 'completed', 'expired')),
    total REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price REAL NOT NULL,
    subtotal REAL NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
`);

const productImages = new Map([
  ['Pupusa de Queso', '/images/pupusa-queso.png'],
  ['Pupusa de Frijol con Queso', '/images/pupusa-frijol-queso.png'],
  ['Pupusa Revuelta', '/images/pupusa-revuelta.png'],
  ['Pupusa de Loroco con Queso', '/images/pupusa-loroco.png'],
  ['Pupusa de Chicharrón', '/images/pupusa-chicharron.png'],
  ['Pupusa de Jalapeño con Queso', '/images/pupusa-jalapeno.png'],
  ['Horchata', '/images/bebida-horchata.png'],
  ['Ensalada', '/images/bebida-ensalada.png'],
  ['Refresco', '/images/bebida-refresco.png'],
  ['Agua', '/images/bebida-agua.png'],
]);

const seed = db.transaction(() => {
  if (db.prepare('SELECT COUNT(*) AS n FROM products').get().n > 0) return;

  const insert = db.prepare(
    'INSERT INTO products (name, category, price, description, image, available) VALUES (?, ?, ?, ?, ?, 1)'
  );
  for (const [name, category, price, description] of [
    ['Pupusa de Queso', 'pupusa', 1.0, 'Queso de leche derretido'],
    ['Pupusa de Frijol con Queso', 'pupusa', 1.0, 'Frijol refrito con queso'],
    ['Pupusa Revuelta', 'pupusa', 1.25, 'Frijol, queso y chicharrón'],
    ['Pupusa de Loroco con Queso', 'pupusa', 1.25, 'Loroco fresco con queso'],
    ['Pupusa de Chicharrón', 'pupusa', 1.25, 'Chicharrón preparado al comal'],
    ['Pupusa de Jalapeño con Queso', 'pupusa', 1.0, 'Jalapeño con queso derretido'],
    ['Horchata', 'bebida', 1.5, 'Horchata de arroz bien fría'],
    ['Ensalada', 'bebida', 1.5, 'Ensalada de frutas de la casa'],
    ['Refresco', 'bebida', 1.0, 'Refresco embotellado'],
    ['Agua', 'bebida', 0.75, 'Botella de agua'],
  ]) {
    insert.run(name, category, price, description, productImages.get(name));
  }
});

// Repara las rutas de imagen de una BD ya existente sin tocar precios ni órdenes.
const syncImages = db.transaction(() => {
  const update = db.prepare(
    'UPDATE products SET image = ? WHERE name = ? AND (image IS NULL OR image = ? OR image <> ?)'
  );
  for (const [name, image] of productImages) update.run(image, name, image, image);
});

seed();
syncImages();

module.exports = db;
