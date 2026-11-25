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

La base SQLite se crea sola en `database/comal.db` con los 10 productos de ejemplo. Al arrancar, `database/db.js` repara las rutas de imagen de los productos ya existentes sin tocar precios ni órdenes.

## Fotos del menú

Las imágenes base son PNG reales en `public/images/` (`pupusa-queso.png`, `bebida-horchata.png`, etc.). Para poner tus fotografías, sobrescribe esos mismos archivos PNG con las fotos finales, conservando el nombre. No hay que tocar código ni la base de datos: Express ya sirve esa carpeta y la interfaz carga las rutas guardadas en la BD.

## Probar

```bash
npm test
```

Comprueba el menú, las páginas estáticas, la validación, los totales, el QR, los cambios de estado y el borrado.

## Flujo

El cliente arma su pedido (guardado en `localStorage`), confirma y recibe número + QR. El QR contiene `{"orderId", "orderNumber", "timestamp"}`. El puesto lo escanea con la cámara (o escribe el número) y actualiza el estado; todo se sincroniza por Socket.io. Las órdenes pendientes con más de 30 minutos pasan a `expired` automáticamente.

> El panel `/admin` no tiene autenticación: solo expóngalo en la red local del puesto.
