# 🔥 Facturación Rápida de Recargas

App **mobile-first ultra simple** para emitir facturas electrónicas de recargas
de extintores desde el celular, sin pasar por el administrador. Sin login
complejo, sin carrito complicado, sin stock.

**HTML / CSS / JS vanilla** — sin frameworks, sin build step. Se sirve en GitHub Pages.

## Flujo

1. **PIN** de 4 dígitos para entrar.
2. **Cliente** — cédula / RUC (o "Consumidor final" de un toque) + nombre.
3. **Productos** — lista fija con buscador; se agregan con cantidad.
4. **FACTURAR** — botón verde gigante → llama a Azur → muestra ✅ y la clave de acceso.

## Estructura

| Archivo | Qué hace |
|---|---|
| `index.html` | Las 3 pantallas (PIN, facturación, resultado) |
| `app.js` | Toda la lógica: PIN, productos, IVA, llamada a Azur, log local |
| `style.css` | Estilos mobile-first |
| `manifest.json` + `sw.js` + `icons/` | PWA: instalable en pantalla de inicio |

## Configuración (en `app.js`, objeto `CONFIG`)

- **PIN** — cambiar `"1234"` por el real.
- **PROXY_URL / TOKEN** — proxy Cloudflare que reenvía a Azur.
- **PRODUCTOS** — lista fija de recargas con precios (sin IVA).
- **IVA** 15% (`TIPO_IVA: 4`).

> ⚠️ **Pendiente antes de producción:**
> - Confirmar **precios reales** y el **PIN** real.
> - **Validar el formato del payload de Azur** contra la implementación que ya
>   funciona en el portal de distribuidores. El payload de `construirPayload()`
>   está hecho con los campos documentados pero debe verificarse campo por campo
>   con una emisión real de prueba antes de usar en el local.

## Deploy (GitHub Pages)

Settings → Pages → Source: *Deploy from a branch* → rama → `/ (root)` → Save.
URL: `https://alejosl0801.github.io/FACTURACION_RECARGAS/`
