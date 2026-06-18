/* =====================================================================
   Facturación Rápida de Recargas — lógica completa (vanilla JS)
   ---------------------------------------------------------------------
   Flujo:  Cliente + Productos  →  FACTURAR  →  Azur  →  ✅ clave
   ===================================================================== */

/* ============ CONFIGURACIÓN ============ */
const CONFIG = {
  // Proxy Cloudflare: emite la factura (token secreto en el worker) y también
  // consulta el SRI (ruta /sri). Hacerlo por el worker evita el bloqueo CORS
  // del navegador y los intermediarios públicos poco confiables.
  PROXY_URL: "https://azur-proxy.alejosl0801.workers.dev/",
  SRI_URL: "https://azur-proxy.alejosl0801.workers.dev/sri",

  IVA: 0.15,          // 15%
  TIPO_IVA: 4,        // código Azur para IVA 15%
  TIPO_PRODUCTO: 1,
  CODIGO_DOC: "01",   // factura

  // Datos del emisor / establecimiento (ajustar a los reales del local)
  EMISOR: {
    direccion: "S/N",
    establecimiento: "001",
    puntoEmision: "001"
  }
};

/* ============ PRODUCTOS (códigos REALES de Azur) ============
   - `cod` = código EXACTO con el que se factura en Azur. NO cambiar.
   - Regla de precio por defecto: cada libra de PQS o CO2 = $1
     (ej. REC10PQS = $10, REC5CO2 = $5). Editable en el carrito.
   - Los duplicados de Azur (códigos terminados en "-") se omiten:
     se deja un solo registro por recarga.                            */
const PRODUCTOS = [
  // --- PQS (precio por defecto = libras × $1) ---
  { cod: "REC3PQS",   nombre: "Recarga 3 lb PQS",    precio: 3.50,   cat: "PQS" },
  { cod: "REC5PQS",   nombre: "Recarga 5 lb PQS",    precio: 5.00,   cat: "PQS" },
  { cod: "REC10PQS",  nombre: "Recarga 10 lb PQS",   precio: 10.00,  cat: "PQS" },
  { cod: "REC20PQS",  nombre: "Recarga 20 lb PQS",   precio: 18.00,  cat: "PQS" },
  // --- CO2 (precio por defecto = libras × $1) ---
  { cod: "REC5CO2",   nombre: "Recarga 5 lb CO2",    precio: 5.00,   cat: "CO2" },
  { cod: "REC10CO2",  nombre: "Recarga 10 lb CO2",   precio: 10.00,  cat: "CO2" },
  { cod: "REC20CO2",  nombre: "Recarga 20 lb CO2",   precio: 18.00,  cat: "CO2" }
];

/* ============ ESTADO ============ */
let carrito = {};            // { cod: cantidad }
let precioUnit = {};         // { cod: precio unitario actual (editable) }
let formaPago = "efectivo";
let categoriaActiva = "PQS"; // pestaña de productos visible: "PQS" o "CO2"

/* ============ HELPERS ============ */
const $ = (sel) => document.querySelector(sel);
const money = (n) => "$" + n.toFixed(2);

function show(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(screenId).classList.add("active");
}

/* =====================================================================
   Cliente
   ===================================================================== */
/* --- Buscar contribuyente en el SRI por cédula/RUC --- */
function setSriMsg(texto, esError) {
  const el = $("#sri-msg");
  el.textContent = texto || "";
  el.className = "sri-msg" + (esError ? " error" : "");
}

/* Consulta el SRI a través de tu worker (devuelve {razonSocial, direccion}). */
async function fetchSRI(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return JSON.parse(await r.text());
}

/* Busca, dentro de un objeto JSON (aunque esté anidado), el valor de la
   primera clave cuyo nombre CONTENGA el término dado (ignora N/D y vacíos). */
function deepFind(obj, termino) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object") {
      const r = deepFind(v, termino);
      if (r) return r;
    } else if (k.toLowerCase().includes(termino)) {
      const s = (v == null ? "" : String(v)).trim();
      if (s && s.toUpperCase() !== "N/D") return s;
    }
  }
  return "";
}
function buscarCampo(obj, terminos) {
  for (const t of terminos) {
    const v = deepFind(obj, t);
    if (v) return v;
  }
  return "";
}

async function buscarSRI() {
  const raw = $("#cliente-id").value.trim();
  if (raw.length !== 10 && raw.length !== 13) {
    setSriMsg("Ingresá una cédula (10 dígitos) o RUC (13 dígitos).", true);
    return;
  }
  const btn = $("#btn-sri");
  const txtOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Buscando...";
  setSriMsg("");

  try {
    // El worker consulta el SRI y devuelve { razonSocial, direccion }
    const data = await fetchSRI(CONFIG.SRI_URL + "?ruc=" + encodeURIComponent(raw));
    const nombre = buscarCampo(data, ["razonsocial", "razon", "nombrecomercial", "nombre", "denominacion"]);

    if (!nombre) {
      setSriMsg("No se encontró ese número en el SRI. Revisá los dígitos.", true);
      return;
    }
    $("#cliente-nombre").value = nombre;

    const direccion = buscarCampo(data, ["direccion", "direccioncompleta"]);
    if (direccion) $("#cliente-dir").value = direccion;

    setSriMsg("✓ Datos cargados del SRI. El teléfono y el correo no son públicos: completalos a mano si los necesitás.");
    actualizarBotonFacturar();
  } catch (err) {
    setSriMsg("No se pudo consultar el SRI: " + (err.message || err) + ". Escribí los datos a mano.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = txtOriginal;
  }
}

$("#btn-sri").addEventListener("click", buscarSRI);

$("#cliente-id").addEventListener("input", actualizarBotonFacturar);
$("#cliente-nombre").addEventListener("input", actualizarBotonFacturar);

/* tipo de identificación según longitud */
function tipoIdentificacion(id) {
  if (id === "9999999999999") return "07";  // consumidor final
  if (id.length === 13) return "04";         // RUC
  if (id.length === 10) return "05";         // cédula
  return null;
}

/* =====================================================================
   PANTALLA 2 — Productos
   ===================================================================== */
function renderProductos(filtro = "") {
  const cont = $("#lista-productos");
  cont.innerHTML = "";
  const f = filtro.trim().toLowerCase();
  PRODUCTOS
    .filter((p) => p.cat === categoriaActiva)
    .filter((p) => p.nombre.toLowerCase().includes(f) || p.cod.toLowerCase().includes(f))
    .forEach((p) => {
      const div = document.createElement("div");
      div.className = "prod";
      div.innerHTML = `
        <div class="prod-info">
          <div class="prod-nombre">${p.nombre} <span class="prod-cod">${p.cod}</span></div>
          <div class="prod-precio">${money(p.precio)}</div>
        </div>
        <div class="prod-add">＋</div>`;
      div.addEventListener("click", () => agregar(p.cod));
      cont.appendChild(div);
    });
  if (cont.children.length === 0) {
    cont.innerHTML = '<p style="color:#7f8c8d;text-align:center;padding:10px">Sin resultados</p>';
  }
}

$("#buscar").addEventListener("input", (e) => renderProductos(e.target.value));

/* pestañas de categoría PQS / CO2 */
document.querySelectorAll(".cat-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".cat-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    categoriaActiva = btn.dataset.cat;
    renderProductos($("#buscar").value);
  });
});

function agregar(cod) {
  carrito[cod] = (carrito[cod] || 0) + 1;
  if (precioUnit[cod] === undefined) {
    precioUnit[cod] = PRODUCTOS.find((x) => x.cod === cod).precio;
  }
  renderCarrito();
}

function cambiarCantidad(cod, delta) {
  carrito[cod] = (carrito[cod] || 0) + delta;
  if (carrito[cod] <= 0) {
    delete carrito[cod];
    delete precioUnit[cod];
  }
  renderCarrito();
}

function renderCarrito() {
  const cont = $("#carrito");
  cont.innerHTML = "";
  const cods = Object.keys(carrito);

  $("#card-carrito").style.display = cods.length ? "block" : "none";

  let subtotal = 0;
  cods.forEach((cod) => {
    const p = PRODUCTOS.find((x) => x.cod === cod);
    const cant = carrito[cod];
    const precio = precioUnit[cod];
    const sub = precio * cant;
    subtotal += sub;

    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <div class="cart-name">${p.nombre} <span class="prod-cod">${p.cod}</span>
        <small class="precio-edit">$ <input type="number" inputmode="decimal" step="0.01" min="0"
          value="${precio.toFixed(2)}" data-act="precio" /> c/u</small>
      </div>
      <div class="qty">
        <button data-act="menos">−</button>
        <span>${cant}</span>
        <button data-act="mas">＋</button>
      </div>
      <div class="cart-sub">${money(sub)}</div>`;
    div.querySelector('[data-act="menos"]').addEventListener("click", () => cambiarCantidad(cod, -1));
    div.querySelector('[data-act="mas"]').addEventListener("click", () => cambiarCantidad(cod, 1));
    const inp = div.querySelector('[data-act="precio"]');
    inp.addEventListener("change", () => {
      let v = parseFloat(inp.value);
      if (isNaN(v) || v < 0) v = 0;
      precioUnit[cod] = v;
      renderCarrito();
    });
    cont.appendChild(div);
  });

  const iva = subtotal * CONFIG.IVA;
  $("#t-subtotal").textContent = money(subtotal);
  $("#t-iva").textContent = money(iva);
  $("#t-total").textContent = money(subtotal + iva);

  actualizarBotonFacturar();
}

/* forma de pago */
document.querySelectorAll(".pago-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pago-opt").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    formaPago = btn.dataset.pago;
  });
});

/* habilitar botón FACTURAR solo si hay cliente válido + productos */
function actualizarBotonFacturar() {
  const id = $("#cliente-id").value.trim();
  const nombre = $("#cliente-nombre").value.trim();
  const tieneProductos = Object.keys(carrito).length > 0;
  const clienteOk = nombre.length > 0 && tipoIdentificacion(id) !== null;
  $("#btn-facturar").disabled = !(tieneProductos && clienteOk);
}

/* =====================================================================
   FACTURAR → Azur
   ===================================================================== */
function construirPayload() {
  const id = $("#cliente-id").value.trim();
  const cods = Object.keys(carrito);

  const items = cods.map((cod) => {
    const p = PRODUCTOS.find((x) => x.cod === cod);
    const cant = carrito[cod];
    return {
      codigo: p.cod,
      descripcion: p.nombre,
      cantidad: cant,
      precioUnitario: Number(precioUnit[cod].toFixed(2)),
      descuento: 0,
      tipo_iva: CONFIG.TIPO_IVA,
      tipoproducto: CONFIG.TIPO_PRODUCTO
    };
  });

  return {
    // El token de Azur lo agrega el worker de Cloudflare (no va en cliente).
    codigoDoc: CONFIG.CODIGO_DOC,
    establecimiento: CONFIG.EMISOR.establecimiento,
    puntoEmision: CONFIG.EMISOR.puntoEmision,
    cliente: {
      tipoIdentificacion: tipoIdentificacion(id),
      identificacion: id,
      razonSocial: $("#cliente-nombre").value.trim(),
      direccion: $("#cliente-dir").value.trim() || "S/N",
      telefono: $("#cliente-tel").value.trim(),
      email: $("#cliente-email").value.trim()
    },
    formaPago: formaPago,
    items: items
  };
}

$("#btn-facturar").addEventListener("click", facturar);

async function facturar() {
  $("#loading").classList.add("active");
  const payload = construirPayload();

  try {
    // El worker reenvía a azur.com.ec/plataforma/api/v2/factura/emision
    // y le agrega el token en privado.
    const resp = await fetch(CONFIG.PROXY_URL + "factura/emision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();

    $("#loading").classList.remove("active");

    if (data && (data.creado === "true" || data.creado === true)) {
      guardarLog(payload, data, true);
      mostrarResultado(true, data.claveacceso || "");
    } else {
      guardarLog(payload, data, false);
      const msg = data.mensaje || data.error || data.message || "No se pudo emitir la factura.";
      mostrarResultado(false, "", msg);
    }
  } catch (err) {
    $("#loading").classList.remove("active");
    guardarLog(payload, { error: String(err) }, false);
    mostrarResultado(false, "", "Error de conexión. Revisá el internet e intentá de nuevo.");
  }
}

function mostrarResultado(ok, clave, msg) {
  if (ok) {
    $("#result-icon").textContent = "✅";
    $("#result-title").textContent = "¡Factura emitida!";
    $("#result-msg").textContent = "Total " + $("#t-total").textContent;
    $("#result-clave").innerHTML = clave
      ? "<strong>Clave de acceso</strong><br>" + clave
      : "";
    $("#result-clave").style.display = clave ? "block" : "none";
  } else {
    $("#result-icon").textContent = "❌";
    $("#result-title").textContent = "No se emitió";
    $("#result-msg").textContent = msg || "Ocurrió un error.";
    $("#result-clave").style.display = "none";
  }
  show("#screen-result");
}

/* nueva factura → limpia todo */
$("#btn-nueva").addEventListener("click", () => {
  carrito = {};
  precioUnit = {};
  $("#cliente-id").value = "";
  $("#cliente-nombre").value = "";
  $("#cliente-dir").value = "";
  $("#cliente-tel").value = "";
  $("#cliente-email").value = "";
  $("#buscar").value = "";
  setSriMsg("");
  renderProductos();
  renderCarrito();
  show("#screen-main");
});

/* =====================================================================
   LOG LOCAL — últimas 100 facturas (solo para referencia del local)
   ===================================================================== */
function guardarLog(payload, respuesta, ok) {
  try {
    const log = JSON.parse(localStorage.getItem("facturas_log") || "[]");
    log.unshift({
      fecha: new Date().toISOString(),
      cliente: payload.cliente.razonSocial,
      identificacion: payload.cliente.identificacion,
      total: $("#t-total").textContent,
      ok: ok,
      claveacceso: respuesta.claveacceso || null
    });
    localStorage.setItem("facturas_log", JSON.stringify(log.slice(0, 100)));
  } catch (e) { /* ignore */ }
}

/* =====================================================================
   INIT
   ===================================================================== */
renderProductos();
renderCarrito();

/* Registrar el service worker (network-first): hace la app instalable
   y siempre muestra la última versión. */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
