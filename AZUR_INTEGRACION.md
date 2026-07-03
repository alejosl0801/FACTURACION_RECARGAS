# Integración con Azur — Guía ultra-detallada de facturación electrónica en Ecuador

> Esta guía documenta el sistema completo que conecta una app web vanilla (HTML/CSS/JS puro,
> sin frameworks) con **Azur** para emitir facturas electrónicas reales autorizadas por el SRI.
> Los productos, códigos y datos del emisor de tu app serán distintos; el **mecanismo** es idéntico.

---

## 1. ¿Qué es Azur?

[Azur](https://azur.com.ec) es una plataforma ecuatoriana que actúa como intermediario
(proveedor de servicios electrónicos) entre tu negocio y el SRI. Tú le mandás los datos
de la factura (cliente, ítems, totales), Azur firma el XML, lo manda al SRI, recibe la
autorización y te devuelve:

- Una **clave de acceso** de 49 dígitos (el número único que identifica la factura en el SRI).
- Un **PDF** con el RIDE (Resumen de Comprobante Electrónico), que es lo que se imprime.

Tu app **nunca habla directamente con el SRI** — todo pasa por Azur.

---

## 2. El problema de seguridad: por qué no se puede llamar a Azur desde el navegador

Azur requiere un `api_key` (y opcionalmente un `api_key2`) para autenticar cada emisión.
Si pusieras esa clave directamente en tu `app.js`, cualquier persona que abriera
las herramientas de desarrollo del navegador la vería, y podría emitir facturas en tu nombre.

**Solución: un Cloudflare Worker como proxy.**

```
[Navegador / app]  →  POST →  [Cloudflare Worker]  →  POST →  [Azur API]
                                  ↑
                          api_key vive ACÁ
                          (variable de entorno secreta)
                          NUNCA llega al navegador
```

El Worker recibe el JSON de tu app (sin la clave), le agrega el `api_key` desde sus
variables de entorno, y reenvía la petición a Azur. La respuesta vuelve por el mismo canal.

---

## 3. Los dos Cloudflare Workers del sistema

### 3.1 `azur-proxy` — emisión + SRI + PDF

**URL:** `https://azur-proxy.TU_USUARIO.workers.dev/`

Rutas que expone:

| Ruta | Método | Qué hace |
|---|---|---|
| `/factura/emision` | POST | Recibe el payload de la factura, agrega `api_key`, llama a `https://azur.com.ec/plataforma/api/v2/factura/emision` y devuelve la respuesta. |
| `/consulta/comprobante` | POST | Recibe `{ claveacceso: "..." }`, consulta en Azur el estado del comprobante y devuelve el objeto con `enlace_pdf`. |
| `/sri` | GET `?ruc=XXXXXXXXXX` | Consulta el RUC o cédula en el SRI y devuelve `razonSocial` y `direccion`. Evita el bloqueo CORS del SRI hacia navegadores. |
| `/clientes` | GET | Devuelve la base de 958 clientes precargada (JSON). |
| `/pdf` | GET `?url=https://...` | Proxy para descargar el PDF de Azur con los headers CORS correctos. Solo acepta URLs de `azur.com.ec` (rechaza cualquier otra con 403). |

**Variables de entorno secretas en el Worker** (se configuran en Cloudflare, nunca en el repo):
- `AZUR_API_KEY` — clave principal de Azur.
- `AZUR_API_KEY2` — clave secundaria (si Azur la requiere).

### 3.2 `nube-clientes` — sincronización de clientes entre celulares

**URL:** `https://nube-clientes.TU_USUARIO.workers.dev/`

Usa **Cloudflare KV** (base de datos clave-valor) para guardar clientes y facturas
en la nube, disponibles en cualquier celular sin instalar nada.

| Ruta | Método | Qué hace |
|---|---|---|
| `/nube` | GET | Devuelve `{ kv: true }` si el KV está correctamente enlazado. |
| `/cliente` | POST | Guarda o actualiza un cliente `{ id, nombre, dir, tel, correo }` en el KV. |
| `/cliente?id=XXXX` | GET | Devuelve el registro de ese cliente desde el KV (sincronización entre celulares). |
| `/facturas` | GET | Devuelve el historial de facturas guardadas en el KV (las últimas 100). |
| `/pdf?url=https://azur...` | GET | Proxy para bajar el PDF real de Azur con CORS correcto. |

---

## 4. El payload de emisión (estructura exacta que acepta Azur v2)

```json
{
  "codigoDoc": "01",
  "emisor": {
    "manejo_interno_secuencia": "SI",
    "fecha_emision": "2025/07/03"
  },
  "comprador": {
    "tipo_identificacion": "05",
    "identificacion": "0912345678",
    "razon_social": "NOMBRE APELLIDO",
    "direccion": "AV. 9 DE OCTUBRE",
    "telefono": "0991234567",
    "celular": null,
    "correo": "cliente@email.com"
  },
  "items": [
    {
      "codigo_principal": "TU_CODIGO_PRODUCTO",
      "codigo_auxiliar": null,
      "descripcion": "NOMBRE DEL PRODUCTO",
      "tipoproducto": 1,
      "tipo_iva": 4,
      "precio_unitario": 10.00,
      "cantidad": 2,
      "descuento": 0
    }
  ],
  "pagos": [
    { "tipo": "01", "total": "23.00" }
  ],
  "informacion_adicional": [
    { "nombre": "Atendido por", "detalle": "NOMBRE_NEGOCIO" }
  ]
}
```

**Campos críticos:**

| Campo | Valor | Significado |
|---|---|---|
| `codigoDoc` | `"01"` | Factura (no nota de crédito, no guía de remisión) |
| `tipo_identificacion` | `"04"` RUC (13 dígitos) / `"05"` cédula (10 dígitos) / `"07"` consumidor final | El SRI rechaza si no coincide con la longitud |
| `tipo_iva` | `4` | IVA 15% (Ecuador 2025). Otros: `0` = 0%, `2` = 12%, `6` = no objeto de IVA |
| `tipoproducto` | `1` | Producto/servicio normal |
| `manejo_interno_secuencia` | `"SI"` | Azur maneja la numeración automáticamente (001-002-XXXXXXXXX) |
| `pagos[].tipo` | `"01"` efectivo / `"20"` transferencia | Código SRI de la forma de pago |

**El `api_key` NO va en este JSON.** Lo agrega el Worker.

---

## 5. Respuesta de Azur

### Éxito:
```json
{ "creado": "true", "claveacceso": "0307202501001002000000011234567890123456789" }
```

### Factura ya emitida (idempotente):
```json
{ "creado": "false", "claveacceso": "...", "errors": "Clave de acceso registrada" }
```
> Esto NO es un error real. La factura ya existe y es válida. La app detecta `/registrad/i`
> en el mensaje y la trata como éxito (muestra el PDF igualmente).

### Error real:
```json
{ "creado": "false", "errors": "Descripción del error..." }
```

---

## 6. Flujo completo de emisión (paso a paso)

```
1. Usuario toca FACTURAR
       ↓
2. app.js valida: cédula/RUC válido, nombre no vacío, al menos 1 producto, total > 0
       ↓
3. construirPayload() arma el JSON con cliente + ítems + totales + forma de pago
       ↓
4. fetch POST → https://azur-proxy.TU_USUARIO.workers.dev/factura/emision
       ↓ (el Worker agrega api_key y reenvía a Azur)
5. Azur firma el XML, manda al SRI, recibe autorización
       ↓
6. Azur responde { creado:"true", claveacceso:"49 dígitos" }
       ↓
7. app.js detecta exito = (data.creado === "true")
       ↓
8. fetch POST → .../consulta/comprobante con { claveacceso: "..." }
       ↓ (Azur devuelve el objeto del comprobante con enlace_pdf)
9. fetch GET → .../pdf?url=https://azur.com.ec/...pdf  (proxy CORS)
       ↓ (devuelve el ArrayBuffer del PDF real)
10. pdf.js renderiza el PDF como imagen en pantalla
        ↓
11. En iPhone: window.open(blobUrl) → visor nativo de Safari → usuario imprime
    En escritorio: window.print() con css @media print
        ↓
12. guardarLog() guarda en localStorage y sube a la nube KV (historial)
    guardarClienteActual() guarda/actualiza el cliente en localStorage y KV
```

---

## 7. Consulta del SRI (autocompletar datos del cliente)

Al escribir la cédula/RUC y tocar "Buscar en SRI":

```
app.js → GET https://azur-proxy.TU_USUARIO.workers.dev/sri?ruc=XXXXXXXXXX
              ↓
         Worker consulta el SRI de Ecuador (API pública)
              ↓
         Devuelve { razonSocial: "NOMBRE EN MAYÚSCULAS", direccion: "..." }
              ↓
app.js llena automáticamente los campos nombre y dirección
```

El Worker es necesario porque el SRI bloquea peticiones CORS directas desde navegadores.

**Búsqueda en 3 capas (orden de prioridad):**
1. Base local del dispositivo (`localStorage` con los clientes ya facturados/importados)
2. Nube KV (cliente registrado desde otro celular)
3. SRI en tiempo real (si no está en ninguna base)

---

## 8. Impresión del PDF real de Azur

El PDF que se imprime es **el PDF oficial de Azur**, no una versión dibujada por la app.
Esto garantiza que el RIDE impreso tenga la firma, el código QR y la autorización del SRI.

### En iPhone (iOS Safari):
```
PDF ArrayBuffer → Blob URL → window.open(blobUrl, "_blank")
→ Safari abre su visor nativo de PDF
→ Usuario toca Compartir (↑) → Imprimir
→ Impresión limpia, sin URL del navegador
```

### En escritorio / Android Chrome:
```
PDF ArrayBuffer → pdf.js renderiza cada página en <canvas>
→ canvas.toDataURL("image/png") convierte a <img>
→ Se ocultan todos los elementos menos las imágenes
→ window.print()
→ Se restauran los elementos en afterprint
```

---

## 9. Base de clientes: sincronización entre celulares

| Mecanismo | Dónde vive | Cuándo se usa |
|---|---|---|
| `localStorage` `"clientes_db"` | Solo en este dispositivo | Búsqueda instantánea sin internet |
| Cloudflare KV | En la nube | Sincronización entre celulares, historial |
| SRI en tiempo real | SRI Ecuador | Clientes nuevos no registrados antes |

**Al facturar:** el cliente se guarda automáticamente en `localStorage` Y se sube al KV.  
**Al buscar:** se consulta primero local → KV → SRI (en ese orden, para minimizar latencia).

---

## 10. Cómo replicar esto en otra app

### Lo que necesitás reutilizar exactamente igual:

1. **El Cloudflare Worker `azur-proxy`** — solo cambiar el `api_key` de tu cuenta Azur.
   La lógica de proxy es idéntica para cualquier facturador.

2. **La estructura del payload** — el JSON de la sección 4.
   Solo cambiás los `codigo_principal`, `descripcion` y precios de tus productos.
   El resto (tipos de IVA, formas de pago, códigos de documento) es igual.

3. **El manejo de la respuesta** — detectar `creado === "true"` y extraer `claveacceso`.

4. **El flujo de impresión PDF** — consulta/comprobante → proxy /pdf → renderizar.

### Lo que es TUYO y cambia en cada app:

- Los productos (códigos, nombres, precios) — completamente distintos.
- Los datos del emisor (RUC, razón social, dirección, establecimiento, punto de emisión).
- El diseño y UX de la app.
- Si usás nube KV o no (es opcional; la facturación funciona sin ella).

### Pasos para montar el sistema desde cero:

1. Crear cuenta en [Azur](https://azur.com.ec) y obtener el `api_key`.
2. Crear un Cloudflare Worker (plan gratuito alcanza).
3. Pegar el código del Worker `azur-proxy` y configurar las variables de entorno con el `api_key`.
4. En tu app, hacer `fetch POST` al Worker con el payload de la sección 4.
5. Manejar la respuesta (sección 5) y mostrar el PDF.

---

## 11. Errores comunes y cómo resolverlos

| Error | Causa | Solución |
|---|---|---|
| `api_key inválido` | La clave no está bien configurada en el Worker | Verificar en Cloudflare → Worker → Settings → Variables |
| `Clave de acceso registrada` | La misma factura se emitió dos veces | No es error, la factura existe. Mostrar el PDF. |
| `tipo_identificacion` rechazado | La longitud del número no coincide con el tipo | 10 dígitos = `"05"` cédula, 13 dígitos = `"04"` RUC |
| `Sin saldo / comprobantes disponibles` | Se agotó el plan en Azur | Recargar el plan en azur.com.ec |
| PDF no carga | El Worker `/pdf` no está configurado o la URL no es de azur.com.ec | Verificar que el Worker proxy esté activo y que `enlace_pdf` venga en la respuesta |
| CORS en producción | El Worker no tiene los headers `Access-Control-Allow-Origin` correctos | Agregar en el Worker: `headers: { "Access-Control-Allow-Origin": "*" }` |

---

*Documento generado a partir de la implementación en producción de PREVIFUEGO (julio 2025).*
