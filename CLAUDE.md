# Contexto técnico — Facturación Rápida de Recargas

App de una sola página (SPA vanilla) para emitir facturas de recargas de
extintores desde el celular. Pensada para una persona no técnica en el local.

## Stack y reglas
- **HTML / CSS / JS vanilla puro.** Sin frameworks, sin npm, sin build step.
- Se despliega tal cual en **GitHub Pages**.
- Mobile-first, botones grandes, una sola columna.

## Archivos
- `index.html` — 3 `<section class="screen">`: `#screen-pin`, `#screen-main`, `#screen-result`.
- `app.js` — `CONFIG` (PIN, proxy, token, IVA), `PRODUCTOS`, lógica de PIN,
  carrito, totales con IVA, `construirPayload()`, `facturar()`, log local.
- `style.css` — estilos. Paleta: rojo `#c0392b`, verde `#27ae60`.
- `manifest.json`, `sw.js`, `icons/` — PWA instalable.

## Integración Azur (facturación electrónica Ecuador)
- Proxy Cloudflare Worker: `https://azur-proxy.alejosl0801.workers.dev/`
  - Se hace `POST /` con JSON; el worker reenvía a
    `https://azur.com.ec/plataforma/api/v2/factura/emision` y añade el token.
- Token: `API_1851_2064_5fcfa1b47f430`
- Respuesta OK: `{ "creado": "true", "claveacceso": "..." }`
- IVA 15% → `tipo_iva: 4`. `tipoproducto: 1`. `codigoDoc: "01"` (factura).
- Tipos de identificación: `"04"` RUC (13 díg), `"05"` cédula (10 díg),
  `"07"` consumidor final (`9999999999999`).

## ⚠️ Verificación pendiente del payload
`construirPayload()` arma el JSON con los campos documentados, pero el esquema
exacto de Azur v2 debe **confirmarse contra el portal de distribuidores** que ya
factura en producción. Antes de usarlo en el local: hacer una emisión de prueba
y ajustar nombres de campos si Azur los rechaza.

## Lo que NO se hace
- No frameworks / build / npm.
- No login complejo (el PIN en el código alcanza para este caso).
- No Supabase ni Google Sheets — las facturas viven en Azur. `localStorage`
  guarda solo un log de referencia de las últimas 100.

## Deploy
GitHub Pages desde la rama, carpeta raíz `/`.
URL: `https://alejosl0801.github.io/FACTURACION_RECARGAS/`
