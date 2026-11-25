# Comal de Chela

Sistema de pedidos por QR: menú móvil para clientes y panel en vivo para el puesto.

## Arrancar

Requiere Node.js 22 o superior (por el binario nativo de `better-sqlite3`).

```bash
npm install
npm start
```

- Menú: http://localhost:3000/
- Panel del puesto: http://localhost:3000/admin
- Desde el celular, en la misma WiFi, usa la IP que imprime el servidor (por ejemplo `http://192.168.1.10:3000/`).

La base SQLite se crea sola en `database/comal.db` con los 10 productos de ejemplo. No hay migraciones ni pasos extra.

## Probar

```bash
npm test
```

Comprueba el menú, las páginas estáticas, la validación, los totales, el QR, los cambios de estado y el borrado.

## Flujo

El cliente arma su pedido (guardado en `localStorage`), confirma y recibe número + QR. El QR contiene `{"orderId", "orderNumber", "timestamp"}`. El puesto lo escanea con la cámara (o escribe el número) y actualiza el estado; todo se sincroniza por Socket.io. Las órdenes pendientes con más de 30 minutos pasan a `expired` automáticamente.

> El panel `/admin` no tiene autenticación: solo expóngalo en la red local del puesto.
