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

  // Datos del emisor (del local) — salen impresos en el comprobante
  EMISOR: {
    razonSocial: "LOPEZ MEJIA ALEJANDRO ALBERTO",
    comercial: "PREVIFUEGO",
    ruc: "0952773976001",
    direccion: "PORTETE #3007 Y GALLEGOS LARA",
    email: "ventas_previfuego@hotmail.com",
    telefonos: "04-2374822 - 0983583325, 0978997247",
    contabilidad: "NO",
    establecimiento: "001",
    puntoEmision: "002"
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
   GENERAR COMPROBANTE PROVISIONAL (NO se factura en Azur)
   - Número y código de barras PROPIOS del local (no son del SRI).
   - La factura electrónica autorizada se emite luego, aparte, en Azur.
   ===================================================================== */
const pad = (n, l) => String(n).padStart(l, "0");

function proximoCorrelativo() {
  const n = (parseInt(localStorage.getItem("prov_seq") || "0", 10) || 0) + 1;
  localStorage.setItem("prov_seq", String(n));
  return n;
}

$("#btn-facturar").addEventListener("click", generarComprobante);

function generarComprobante() {
  const seq = proximoCorrelativo();
  const ahora = new Date();
  const f = (x) => pad(x, 2);
  const ymd = "" + ahora.getFullYear() + f(ahora.getMonth() + 1) + f(ahora.getDate());
  const fechaTxt = f(ahora.getDate()) + "/" + f(ahora.getMonth() + 1) + "/" + ahora.getFullYear();
  const horaTxt = f(ahora.getHours()) + ":" + f(ahora.getMinutes());

  // N° de comprobante y código de control INTERNO del local (NO son del SRI)
  const numProv = CONFIG.EMISOR.establecimiento + "-" + CONFIG.EMISOR.puntoEmision + "-" + pad(seq, 9);
  const codInterno = "PRV" + ymd + pad(seq, 6);

  const cli = {
    id: $("#cliente-id").value.trim(),
    nombre: $("#cliente-nombre").value.trim(),
    dir: $("#cliente-dir").value.trim() || "—",
    tel: $("#cliente-tel").value.trim() || "—",
    email: $("#cliente-email").value.trim() || "—"
  };

  let subtotal = 0;
  const filas = Object.keys(carrito).map((cod) => {
    const p = PRODUCTOS.find((x) => x.cod === cod);
    const cant = carrito[cod];
    const pu = precioUnit[cod];
    const sub = pu * cant;
    subtotal += sub;
    return "<tr><td>" + p.cod + "</td><td>" + cant.toFixed(2) + "</td><td>" + p.nombre +
      "</td><td class='num'>" + money(pu) + "</td><td class='num'>$0.00</td><td class='num'>" +
      money(sub) + "</td></tr>";
  }).join("");

  const iva = subtotal * CONFIG.IVA;
  const total = subtotal + iva;
  const formaTxt = formaPago === "transferencia" ? "TRANSFERENCIA / SISTEMA FINANCIERO" : "EFECTIVO";
  const E = CONFIG.EMISOR;
  const barras = window.barcode39SVG(codInterno, { height: 55, narrow: 2, ratio: 3 });

  const row = (l, v) => '<div><span>' + l + '</span><b>' + v + '</b></div>';

  $("#comprobante").innerHTML =
    '<div class="ride">' +
      '<div class="ride-top">' +
        '<div class="ride-emisor">' +
          '<div class="ride-logo">🔥 ' + E.comercial + '</div>' +
          '<div class="ride-rs">' + E.razonSocial + '</div>' +
          '<div>Dir. Matriz: ' + E.direccion + '</div>' +
          '<div>' + E.email + '</div>' +
          '<div>Tel: ' + E.telefonos + '</div>' +
          '<div>Obligado a llevar contabilidad: <b>' + E.contabilidad + '</b></div>' +
        '</div>' +
        '<div class="ride-doc">' +
          '<div class="ride-ruc">R.U.C.: ' + E.ruc + '</div>' +
          '<div class="ride-tipo">COMPROBANTE PROVISIONAL</div>' +
          '<div class="ride-no">No. ' + numProv + '</div>' +
          '<div class="ride-lbl">NÚMERO DE CONTROL INTERNO</div>' +
          '<div class="ride-lbl ride-nosri">(documento propio del local · no es autorización del SRI)</div>' +
          '<div class="ride-cod">' + codInterno + '</div>' +
          '<div class="ride-barras">' + barras + '</div>' +
          '<div class="ride-fh">FECHA Y HORA: ' + fechaTxt + ' ' + horaTxt + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ride-cliente">' +
        '<div class="r2"><span><b>Razón Social / Nombres:</b> ' + cli.nombre + '</span>' +
          '<span><b>Identificación:</b> ' + cli.id + '</span></div>' +
        '<div class="r2"><span><b>Fecha Emisión:</b> ' + fechaTxt + '</span>' +
          '<span><b>Teléfono:</b> ' + cli.tel + '</span></div>' +
        '<div><b>Dirección:</b> ' + cli.dir + '</div>' +
        '<div><b>Email:</b> ' + cli.email + '</div>' +
      '</div>' +
      '<table class="ride-items"><thead><tr>' +
        '<th>Cód. Principal</th><th>Cant.</th><th>Descripción</th>' +
        '<th class="num">P. Unitario</th><th class="num">Descuento</th><th class="num">Subtotal</th>' +
        '</tr></thead><tbody>' + filas + '</tbody></table>' +
      '<div class="ride-bottom">' +
        '<div class="ride-adic">' +
          '<div class="ride-sech">Información Adicional</div>' +
          '<div class="ride-fp"><b>Forma de Pago</b><span class="num"><b>Valor</b></span></div>' +
          '<div class="ride-fp"><span>' + formaTxt + '</span><span class="num">' + money(total) + '</span></div>' +
        '</div>' +
        '<div class="ride-tot">' +
          row('Subtotal 15%', money(subtotal)) +
          row('Subtotal 0%', '$0.00') +
          row('Subtotal no objeto de IVA', '$0.00') +
          row('Subtotal Exento de IVA', '$0.00') +
          row('Subtotal Sin Impuestos', money(subtotal)) +
          row('Descuento', '$0.00') +
          row('ICE', '$0.00') +
          row('IVA 15%', money(iva)) +
          row('IRBPNR', '$0.00') +
          row('Propina', '$0.00') +
          '<div class="ride-vt"><span>VALOR TOTAL</span><b>' + money(total) + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="ride-foot">Documento provisional generado en el local. ' +
        'La factura electrónica autorizada por el SRI se enviará al correo del cliente.</div>' +
    '</div>';

  guardarLog(cli, numProv, total);
  show("#screen-result");
}

/* Imprimir y compartir el comprobante */
$("#btn-imprimir").addEventListener("click", () => window.print());

$("#btn-compartir").addEventListener("click", async () => {
  const texto = $("#comprobante").innerText;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Comprobante PREVIFUEGO", text: texto });
    } else {
      await navigator.clipboard.writeText(texto);
      alert("Comprobante copiado. Pegalo en WhatsApp.");
    }
  } catch (e) { /* cancelado */ }
});

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
   LOG LOCAL — últimos 100 comprobantes provisionales (para que vos los
   factures luego en Azur). Guarda cliente, número, total e ítems.
   ===================================================================== */
function guardarLog(cli, numProv, total) {
  try {
    const items = Object.keys(carrito).map((cod) => {
      const p = PRODUCTOS.find((x) => x.cod === cod);
      return { cod: p.cod, nombre: p.nombre, cant: carrito[cod], precio: precioUnit[cod] };
    });
    const log = JSON.parse(localStorage.getItem("comprobantes_log") || "[]");
    log.unshift({
      fecha: new Date().toISOString(),
      numero: numProv,
      cliente: cli.nombre,
      identificacion: cli.id,
      direccion: cli.dir,
      telefono: cli.tel,
      email: cli.email,
      total: Number(total.toFixed(2)),
      items: items
    });
    localStorage.setItem("comprobantes_log", JSON.stringify(log.slice(0, 100)));
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
