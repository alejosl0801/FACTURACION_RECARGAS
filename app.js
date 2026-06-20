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

  USUARIO: "Fabiola", // a quién saluda la app (se siente suya)

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
   BASE DE CLIENTES (vive SOLO en el dispositivo — localStorage)
   - Se importa una vez (archivo JSON/CSV exportado de Azur).
   - Al buscar, se consulta primero acá (trae nombre/dir/tel/correo).
   - Los clientes nuevos o editados se guardan automáticamente.
   ===================================================================== */
let _clientesIndex = null;
function clientesDB() {
  try { return JSON.parse(localStorage.getItem("clientes_db") || "[]"); } catch (e) { return []; }
}
function indexClientes() {
  _clientesIndex = {};
  clientesDB().forEach((c) => { if (c && c.id) _clientesIndex[String(c.id).trim()] = c; });
}
function buscarClienteLocal(id) {
  if (!_clientesIndex) indexClientes();
  return _clientesIndex[String(id).trim()] || null;
}
function guardarClienteActual() {
  const id = $("#cliente-id").value.trim();
  if (!id) return;
  const rec = {
    id: id, tipo: tipoIdentificacion(id) || "",
    nombre: $("#cliente-nombre").value.trim(),
    dir: $("#cliente-dir").value.trim(),
    tel: $("#cliente-tel").value.trim(), cel: "",
    correo: $("#cliente-email").value.trim()
  };
  if (!rec.nombre) return;
  const db = clientesDB();
  const i = db.findIndex((c) => String(c.id).trim() === id);
  if (i >= 0) db[i] = Object.assign({}, db[i], rec); else db.push(rec);
  localStorage.setItem("clientes_db", JSON.stringify(db));
  _clientesIndex = null;
}

/* CSV con campos entre comillas (las direcciones tienen comas) */
function parseCSVClientes(txt) {
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  const parseLine = (line) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else { if (ch === '"') q = true; else if (ch === ",") { out.push(cur); cur = ""; } else cur += ch; }
    }
    out.push(cur); return out;
  };
  const head = parseLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (n) => head.findIndex((h) => h.includes(n));
  const iId = idx("identif"), iTipo = idx("tipo"), iNom = idx("razon"),
    iDir = idx("direc"), iTel = idx("telefono"), iCel = idx("celular"), iCor = idx("correo");
  const arr = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i]);
    const id = (c[iId] || "").replace(/^'/, "").trim();
    if (!id) continue;
    arr.push({
      id, tipo: (c[iTipo] || "").trim(), nombre: (c[iNom] || "").trim(),
      dir: (c[iDir] || "").trim(), tel: (c[iTel] || "").trim(),
      cel: (c[iCel] || "").trim(), correo: (c[iCor] || "").trim()
    });
  }
  return arr;
}

/* Importar clientes está OCULTO para Fabiola: se abre manteniendo
   presionado el título (🔥) ~1.2 s. Así no lo toca por error. */
(function () {
  const t = $("#topbar-title");
  let timer = null;
  const start = () => { timer = setTimeout(() => $("#file-clientes").click(), 1200); };
  const cancel = () => { if (timer) clearTimeout(timer); };
  ["mousedown", "touchstart"].forEach((ev) => t.addEventListener(ev, start));
  ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((ev) => t.addEventListener(ev, cancel));
})();

$("#file-clientes").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const txt = reader.result;
      const arr = file.name.toLowerCase().endsWith(".csv") ? parseCSVClientes(txt) : JSON.parse(txt);
      if (!Array.isArray(arr)) throw new Error("formato no válido");
      localStorage.setItem("clientes_db", JSON.stringify(arr));
      _clientesIndex = null;
      alert("✓ Clientes importados: " + arr.length);
    } catch (err) {
      alert("No se pudo leer el archivo: " + (err.message || err));
    }
    e.target.value = "";
  };
  reader.readAsText(file, "utf-8");
});

/* =====================================================================
   Cliente
   ===================================================================== */
/* --- Buscar contribuyente en el SRI por cédula/RUC --- */
function setSriMsg(texto, esError) {
  const el = $("#sri-msg");
  el.textContent = texto || "";
  el.className = "sri-msg" + (esError ? " error" : "");
}

/* Consulta el SRI a través de tu worker (devuelve {razonSocial, direccion}).
   Reintenta 1 vez si la red falla (consulta de solo lectura, seguro reintentar). */
async function fetchSRI(url) {
  let err;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return JSON.parse(await r.text());
    } catch (e) {
      err = e;
      await new Promise((res) => setTimeout(res, 800));
    }
  }
  throw err;
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

  // 1) Primero en TU base de clientes (datos completos)
  const local = buscarClienteLocal(raw);
  if (local) {
    $("#cliente-nombre").value = local.nombre || "";
    if (local.dir) $("#cliente-dir").value = local.dir;
    const tel = local.tel || local.cel || "";
    if (tel) $("#cliente-tel").value = tel;
    if (local.correo) $("#cliente-email").value = local.correo;
    setSriMsg("✓ Cliente encontrado en tu base.");
    actualizarBotonFacturar();
    guardarBorrador();
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
    guardarBorrador();
  } catch (err) {
    setSriMsg("No se pudo consultar el SRI: " + (err.message || err) + ". Escribí los datos a mano.", true);
  } finally {
    btn.disabled = false;
    btn.textContent = txtOriginal;
  }
}

$("#btn-sri").addEventListener("click", buscarSRI);

["#cliente-id", "#cliente-nombre", "#cliente-dir", "#cliente-tel", "#cliente-email"].forEach((sel) => {
  $(sel).addEventListener("input", () => { actualizarBotonFacturar(); guardarBorrador(); });
});

/* Enter en cédula/RUC busca en el SRI; al salir del campo también
   (si tiene 10 o 13 dígitos). Sirve igual para cédula y RUC. */
$("#cliente-id").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); buscarSRI(); }
});
$("#cliente-id").addEventListener("change", () => {
  const n = $("#cliente-id").value.trim().length;
  if (n === 10 || n === 13) buscarSRI();
});

/* tipo de identificación según longitud */
function tipoIdentificacion(id) {
  if (id === "9999999999999") return "07";  // consumidor final
  if (id.length === 13) return "04";         // RUC
  if (id.length === 10) return "05";         // cédula
  return null;
}

/* Validación de cédula ecuatoriana (algoritmo módulo 10) */
function validarCedula(ced) {
  if (!/^\d{10}$/.test(ced)) return false;
  const prov = parseInt(ced.slice(0, 2), 10);
  if (prov < 1 || (prov > 24 && prov !== 30)) return false;
  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) { let v = parseInt(ced[i], 10) * coef[i]; if (v >= 10) v -= 9; suma += v; }
  const dv = (10 - (suma % 10)) % 10;
  return dv === parseInt(ced[9], 10);
}
/* true si la identificación PARECE tener un error de tipeo
   (solo valida cédula y RUC de persona natural; no rechaza RUC de empresa) */
function identificacionSospechosa(id) {
  if (id === "9999999999999") return false;
  if (id.length === 10) return !validarCedula(id);
  if (id.length === 13) {
    const tercer = parseInt(id[2], 10);
    if (tercer < 6) return !validarCedula(id.slice(0, 10)); // RUC persona natural
    return false; // jurídico/público: no validamos para no rechazar válidos
  }
  return true;
}

/* Forma de pago: marcar el botón activo según la variable */
function setFormaPagoUI() {
  document.querySelectorAll(".pago-opt").forEach((b) => b.classList.toggle("active", b.dataset.pago === formaPago));
}

/* Borrador de la venta (para no perderla si se cierra/recarga la app) */
function guardarBorrador() {
  try {
    localStorage.setItem("borrador", JSON.stringify({
      id: $("#cliente-id").value, nombre: $("#cliente-nombre").value, dir: $("#cliente-dir").value,
      tel: $("#cliente-tel").value, email: $("#cliente-email").value,
      carrito: carrito, precioUnit: precioUnit, formaPago: formaPago
    }));
  } catch (e) {}
}
function limpiarBorrador() { try { localStorage.removeItem("borrador"); } catch (e) {} }
function restaurarSesion() {
  const fp = localStorage.getItem("forma_pago"); // última forma de pago usada
  if (fp) formaPago = fp;
  try {
    const b = JSON.parse(localStorage.getItem("borrador") || "null");
    if (b) {
      if (b.id) $("#cliente-id").value = b.id;
      if (b.nombre) $("#cliente-nombre").value = b.nombre;
      if (b.dir) $("#cliente-dir").value = b.dir;
      if (b.tel) $("#cliente-tel").value = b.tel;
      if (b.email) $("#cliente-email").value = b.email;
      if (b.carrito && typeof b.carrito === "object") carrito = b.carrito;
      if (b.precioUnit && typeof b.precioUnit === "object") precioUnit = b.precioUnit;
      if (b.formaPago) formaPago = b.formaPago;
    }
  } catch (e) {}
  setFormaPagoUI();
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

/* pestañas de categoría PQS / CO2 */
document.querySelectorAll(".cat-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".cat-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    categoriaActiva = btn.dataset.cat;
    renderProductos();
  });
});

function vibrar(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

function agregar(cod) {
  carrito[cod] = (carrito[cod] || 0) + 1;
  if (precioUnit[cod] === undefined) {
    precioUnit[cod] = PRODUCTOS.find((x) => x.cod === cod).precio;
  }
  vibrar(30);
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
  guardarBorrador();
}

/* forma de pago */
document.querySelectorAll(".pago-opt").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pago-opt").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    formaPago = btn.dataset.pago;
    try { localStorage.setItem("forma_pago", formaPago); } catch (e) {} // recordar la última
    guardarBorrador();
  });
});

/* habilitar botón FACTURAR solo si hay cliente válido + productos */
function actualizarBotonFacturar() {
  const id = $("#cliente-id").value.trim();
  const nombre = $("#cliente-nombre").value.trim();
  const tieneProductos = Object.keys(carrito).length > 0;
  const clienteOk = nombre.length > 0 && tipoIdentificacion(id) !== null;
  $("#btn-facturar").disabled = !(tieneProductos && clienteOk);

  // Pista simple de qué falta (para que Fabiola no se trabe)
  let hint = "";
  if (!clienteOk) hint = "Falta el cliente";
  else if (!tieneProductos) hint = "Falta agregar un producto";
  $("#facturar-hint").textContent = hint;
}

/* =====================================================================
   EMITIR FACTURA REAL en Azur (api/v2/factura/emision por el worker)
   y mostrarla para imprimir con su autorización auténtica.
   ===================================================================== */
const pad = (n, l) => String(n).padStart(l, "0");
const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function contextoVenta() {
  const cli = {
    id: $("#cliente-id").value.trim(),
    nombre: $("#cliente-nombre").value.trim(),
    dir: $("#cliente-dir").value.trim() || "S/N",
    tel: $("#cliente-tel").value.trim() || "—",
    email: $("#cliente-email").value.trim() || "—"
  };
  let subtotal = 0;
  const filas = Object.keys(carrito).map((cod) => {
    const p = PRODUCTOS.find((x) => x.cod === cod);
    const cant = carrito[cod], pu = precioUnit[cod], sub = pu * cant;
    subtotal += sub;
    return "<tr><td>" + p.cod + "</td><td>" + cant.toFixed(2) + "</td><td>" + p.nombre +
      "</td><td class='num'>" + money(pu) + "</td><td class='num'>$0.00</td><td class='num'>" +
      money(sub) + "</td></tr>";
  }).join("");
  const iva = subtotal * CONFIG.IVA, total = subtotal + iva;
  const formaTxt = formaPago === "transferencia" ? "TRANSFERENCIA / SISTEMA FINANCIERO" : "EFECTIVO";
  return { cli, filas, subtotal, iva, total, formaTxt };
}

function construirPayload(ctx) {
  const a = new Date();
  const f = (x) => pad(x, 2);
  const items = Object.keys(carrito).map((cod) => {
    const p = PRODUCTOS.find((x) => x.cod === cod);
    return {
      codigo_principal: p.cod,
      codigo_auxiliar: null,
      descripcion: p.nombre,
      tipoproducto: CONFIG.TIPO_PRODUCTO,
      tipo_iva: CONFIG.TIPO_IVA,
      precio_unitario: Number(precioUnit[cod].toFixed(2)),
      cantidad: carrito[cod],
      descuento: 0
    };
  });
  return {
    // api_key lo agrega el worker en privado (no va en este código)
    codigoDoc: CONFIG.CODIGO_DOC,
    emisor: {
      manejo_interno_secuencia: "SI",
      fecha_emision: a.getFullYear() + "/" + f(a.getMonth() + 1) + "/" + f(a.getDate())
    },
    comprador: {
      tipo_identificacion: tipoIdentificacion(ctx.cli.id),
      identificacion: ctx.cli.id,
      razon_social: ctx.cli.nombre,
      direccion: ctx.cli.dir,
      telefono: $("#cliente-tel").value.trim() || null,
      celular: null,
      correo: $("#cliente-email").value.trim() || null
    },
    items: items,
    pagos: [{ tipo: formaPago === "transferencia" ? "20" : "01", total: ctx.total.toFixed(2) }],
    informacion_adicional: [{ nombre: "Atendido por", detalle: CONFIG.EMISOR.comercial }]
  };
}

$("#btn-facturar").addEventListener("click", facturar);

let emitiendo = false; // evita doble emisión por doble toque
let ultimaClave = "";  // clave de acceso de la última factura emitida

async function facturar() {
  if (emitiendo) return;
  const ctx = contextoVenta();

  // Seguridad: total en $0
  if (ctx.total <= 0) { alert("El total es $0. Revisá los precios o agregá un producto."); return; }
  // Aviso si la cédula/RUC parece tener un error de tipeo
  if (identificacionSospechosa(ctx.cli.id)) {
    if (!window.confirm("La cédula/RUC parece tener un error. ¿Emitir de todos modos?")) return;
  }
  // Confirmación clara antes de emitir (evita facturas por error)
  if (!window.confirm("¿Emitir factura por " + money(ctx.total) + " a " + ctx.cli.nombre + "?")) return;

  emitiendo = true;
  $("#loading").classList.add("active");
  let data;
  try {
    const resp = await fetch(CONFIG.PROXY_URL + "factura/emision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(construirPayload(ctx))
    });
    const txt = await resp.text();
    try { data = JSON.parse(txt); } catch (e) { data = { _respuesta: txt, _status: resp.status }; }
  } catch (err) {
    data = { error: String(err) };
  }
  $("#loading").classList.remove("active");
  emitiendo = false;

  // Guardar/actualizar el cliente en la base local del dispositivo
  guardarClienteActual();

  // Éxito SOLO si Azur dice creado:"true" (ojo: en errores también puede venir claveacceso)
  const exito = data && (data.creado === "true" || data.creado === true);
  const clave = (data && (data.claveacceso || data.claveAcceso || data.clave_acceso)) || "";
  const msgErr = mensajeError(data);
  // "Clave de acceso registrada" = la factura YA existe en Azur → es válida, la mostramos
  const yaEmitida = !exito && clave && /registrad/i.test(msgErr);
  if (exito || yaEmitida) {
    ultimaClave = clave;
    vibrar([60, 40, 120]);
    renderFactura(ctx, data, clave, yaEmitida);
    guardarLog(ctx.cli, clave, ctx.total);
    limpiarBorrador(); // venta completada: ya no hay borrador
  } else {
    ultimaClave = "";
    vibrar(200);
    renderRespuesta(data);
  }
  show("#screen-result");
}

/* Extrae el mensaje de error de Azur (errors puede ser arreglo u objeto) */
function mensajeError(data) {
  if (!data) return "";
  let e = data.errors || data.error || "";
  if (Array.isArray(e)) return e.join(" · ");
  if (e && typeof e === "object") return Object.values(e).join(" · ");
  return String(e);
}

/* Factura REAL autorizada (clave devuelta por Azur) */
function renderFactura(ctx, data, clave, yaEmitida) {
  const E = CONFIG.EMISOR;
  const a = new Date();
  const f = (x) => pad(x, 2);
  const fechaTxt = f(a.getDate()) + "/" + f(a.getMonth() + 1) + "/" + a.getFullYear() +
    " " + f(a.getHours()) + ":" + f(a.getMinutes());
  const num = data.secuencial || data.numero || data.numeroFactura || "";
  const ambiente = data.ambiente || "PRODUCCIÓN";
  const barras = window.barcode39SVG(clave, { height: 55, narrow: 1, ratio: 3 });
  const row = (l, v) => '<div><span>' + l + '</span><b>' + v + '</b></div>';

  $("#comprobante").innerHTML =
    '<div class="estado-ok no-print">' + (yaEmitida ? "✅ FACTURA (ya estaba emitida)" : "✅ FACTURA LISTA") + '</div>' +
    '<div class="ride">' +
      '<div class="ride-top">' +
        '<div class="ride-emisor">' +
          '<img class="ride-logo-img" src="logo.jpg" alt="PREVIFUEGO">' +
          '<div class="ride-rs">' + E.razonSocial + '</div>' +
          '<div><b>' + E.comercial + '</b> — Matriz</div>' +
          '<div>Dir: ' + E.direccion + '</div>' +
          '<div>' + E.email + '</div>' +
          '<div>' + E.telefonos + '</div>' +
          '<div>Obligado a llevar contabilidad: ' + E.contabilidad + '</div>' +
        '</div>' +
        '<div class="ride-doc">' +
          '<div class="ride-tipo">FACTURA</div>' +
          '<div class="ride-docbox">' +
            '<div><span>R.U.C.:</span> <b>' + E.ruc + '</b></div>' +
            (num ? '<div><span>No.:</span> <b>' + num + '</b></div>' : '') +
            '<div class="ride-lbl">NÚMERO DE AUTORIZACIÓN</div>' +
            '<div class="ride-cod">' + clave + '</div>' +
            '<div><span>AMBIENTE:</span> <b>' + ambiente + '</b> &nbsp; EMISIÓN: NORMAL</div>' +
            '<div><span>FECHA Y HORA:</span> ' + fechaTxt + '</div>' +
          '</div>' +
          '<div class="ride-barras">' + barras + '</div>' +
          '<div class="ride-barras-txt">' + clave + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ride-cliente">' +
        '<div class="r2"><span><b>Razón Social / Nombres:</b> ' + ctx.cli.nombre + '</span>' +
          '<span><b>Identificación:</b> ' + ctx.cli.id + '</span></div>' +
        '<div class="r2"><span><b>Dirección:</b> ' + ctx.cli.dir + '</span>' +
          '<span><b>Fecha Emisión:</b> ' + fechaTxt + '</span></div>' +
        '<div class="r2"><span><b>Teléfono:</b> ' + ctx.cli.tel + '</span>' +
          '<span><b>Email:</b> ' + ctx.cli.email + '</span></div>' +
      '</div>' +
      '<table class="ride-items"><thead><tr>' +
        '<th>Cód.</th><th>Cant.</th><th>Descripción</th>' +
        '<th class="num">P. Unitario</th><th class="num">Descuento</th><th class="num">Subtotal</th>' +
        '</tr></thead><tbody>' + ctx.filas + '</tbody></table>' +
      '<div class="ride-bottom">' +
        '<div class="ride-adic">' +
          '<div class="ride-sech">Información Adicional</div>' +
          '<table class="ride-fp"><thead><tr><th>Forma de Pago</th><th class="num">Valor</th>' +
            '<th>Plazo</th><th>Tiempo</th></tr></thead>' +
            '<tbody><tr><td>' + ctx.formaTxt + '</td><td class="num">' + money(ctx.total) + '</td>' +
            '<td>—</td><td>—</td></tr></tbody></table>' +
        '</div>' +
        '<div class="ride-tot">' +
          row('Subtotal 15%', money(ctx.subtotal)) +
          row('Subtotal 0%', '$0.00') +
          row('Subtotal no objeto de IVA', '$0.00') +
          row('Subtotal Exento de IVA', '$0.00') +
          row('Subtotal Sin Impuestos', money(ctx.subtotal)) +
          row('Descuento', '$0.00') +
          row('ICE', '$0.00') +
          row('IVA 15%', money(ctx.iva)) +
          row('IRBPNR', '$0.00') +
          row('Propina', '$0.00') +
          '<div class="ride-vt"><span>VALOR TOTAL</span><b>' + money(ctx.total) + '</b></div>' +
        '</div>' +
      '</div>' +
      '<div class="ride-foot">Comprobante electrónico AUTORIZADO por el SRI · Clave de acceso: ' + clave + '</div>' +
    '</div>';
}

/* Si Azur NO autorizó: mostrar el/los motivo(s) de forma clara */
function renderRespuesta(data) {
  const msg = mensajeError(data);
  const cuerpo = msg
    ? '<p style="margin:8px 0 0;font-size:16px;color:#000;font-weight:600">' + escapeHtml(msg) + '</p>'
    : '<pre style="white-space:pre-wrap;word-break:break-word;background:#f4f4f4;padding:10px;' +
      'border-radius:6px;font-size:11px;color:#000">' + escapeHtml(JSON.stringify(data, null, 2)) + '</pre>';
  $("#comprobante").innerHTML =
    '<div class="ride" style="padding:16px">' +
      '<div class="ride-tipo" style="color:#c0392b;font-size:18px">No se emitió la factura</div>' +
      '<p style="margin:8px 0;font-size:12px">Azur informó:</p>' + cuerpo +
    '</div>';
}

/* Busca un PDF dentro de la respuesta de Azur (venga como base64 o URL) */
function buscarPdf(o) {
  let res = null;
  (function walk(x) {
    if (res || x == null) return;
    if (typeof x === "string") {
      const s = x.trim();
      const i = s.indexOf("JVBERi0"); // "%PDF-" en base64
      if (i >= 0) { res = { tipo: "base64", valor: s.slice(i) }; return; }
      if (/^https?:\/\//.test(s) && /pdf|ride|comprobante/i.test(s)) { res = { tipo: "url", valor: s }; return; }
      return;
    }
    if (typeof x === "object") { for (const k in x) { walk(x[k]); if (res) return; } }
  })(o);
  return res;
}
function abrirPdfBase64(b64) {
  try {
    const bin = atob(b64.replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    window.open(url, "_blank");
    return true;
  } catch (e) { return false; }
}

/* Muestra en pantalla la estructura de la respuesta de Azur (para diagnóstico) */
function mostrarDiagnostico(txt) {
  let resumen;
  try {
    const d = JSON.parse(txt);
    resumen = Object.keys(d).map((k) => {
      const v = d[k]; const t = typeof v;
      const prev = (t === "string") ? v.slice(0, 70) : JSON.stringify(v).slice(0, 70);
      return "• " + k + "  (" + t + (t === "string" ? ", " + v.length + " car" : "") + ")\n   " + prev;
    }).join("\n\n");
  } catch (e) { resumen = String(txt).slice(0, 1500); }
  $("#comprobante").innerHTML =
    '<div class="ride" style="padding:16px">' +
      '<div class="ride-tipo" style="font-size:18px;color:#c0392b">Respuesta de Azur (consulta)</div>' +
      '<p style="font-size:12px;margin:6px 0">Sacale una captura y mandámela para ajustar el PDF:</p>' +
      '<pre style="white-space:pre-wrap;word-break:break-all;background:#f4f4f4;padding:10px;' +
      'font-size:11px;color:#000">' + escapeHtml(resumen) + '</pre>' +
    '</div>';
}

/* IMPRIMIR: trae el PDF REAL de Azur (idéntico al suyo). Si no encuentra el
   PDF, muestra la respuesta de Azur para diagnosticar. */
/* Abre el PDF REAL de Azur (consulta/comprobante → campo enlace_pdf) */
async function abrirPdfDeAzur(clave) {
  if (!clave) { window.print(); return; }
  try {
    const r = await fetch(CONFIG.PROXY_URL + "consulta/comprobante", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claveacceso: clave })
    });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch (e) { d = null; }
    const pdfUrl = d && (d.enlace_pdf || d.enlacePdf || d.pdf_url);
    if (pdfUrl) { window.open(pdfUrl, "_blank"); return; }
    // Respaldo: buscar PDF en cualquier forma; si no, imprimir la vista
    const found = d && buscarPdf(d);
    if (found && found.tipo === "url") { window.open(found.valor, "_blank"); return; }
    if (found && found.tipo === "base64" && abrirPdfBase64(found.valor)) return;
  } catch (e) { /* sin conexión → imprime la vista */ }
  window.print();
}

$("#btn-imprimir").addEventListener("click", () => abrirPdfDeAzur(ultimaClave));

/* =====================================================================
   HISTORIAL — últimas 20 facturas, con reimpresión (abre el PDF de Azur)
   ===================================================================== */
function renderHistorial() {
  let log = [];
  try { log = JSON.parse(localStorage.getItem("comprobantes_log") || "[]"); } catch (e) {}
  const cont = $("#lista-historial");
  if (!log.length) {
    cont.innerHTML = '<p style="text-align:center;color:#7f8c8d;padding:24px">Todavía no hay facturas emitidas.</p>';
    return;
  }
  cont.innerHTML = "";
  log.slice(0, 20).forEach((fac) => {
    const d = new Date(fac.fecha);
    const fecha = isNaN(d.getTime()) ? "" :
      (pad(d.getDate(), 2) + "/" + pad(d.getMonth() + 1, 2) + "  " + pad(d.getHours(), 2) + ":" + pad(d.getMinutes(), 2));
    const div = document.createElement("div");
    div.className = "hist-item";
    div.innerHTML =
      '<div class="hist-info">' +
        '<div class="hist-cli">' + escapeHtml(fac.cliente || "—") + '</div>' +
        '<div class="hist-meta">' + fecha + (fac.identificacion ? " · " + escapeHtml(fac.identificacion) : "") + '</div>' +
      '</div>' +
      '<div class="hist-total">' + money(Number(fac.total) || 0) + '</div>' +
      '<button class="hist-print">🖨️</button>';
    div.querySelector(".hist-print").addEventListener("click", () => abrirPdfDeAzur(fac.numero));
    cont.appendChild(div);
  });
}
$("#btn-historial").addEventListener("click", () => { renderHistorial(); show("#screen-historial"); });
$("#btn-hist-volver").addEventListener("click", () => show("#screen-main"));

/* nueva factura → limpia todo */
$("#btn-nueva").addEventListener("click", () => {
  carrito = {};
  precioUnit = {};
  $("#cliente-id").value = "";
  $("#cliente-nombre").value = "";
  $("#cliente-dir").value = "";
  $("#cliente-tel").value = "";
  $("#cliente-email").value = "";
  setSriMsg("");
  limpiarBorrador();
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
/* Saludo personalizado (que Fabiola sienta que la app es suya) */
function setSaludo() {
  const el = $("#saludo");
  if (!el) return;
  const h = new Date().getHours();
  const parte = h < 12 ? "☀️ Buenos días" : (h < 19 ? "🌤️ Buenas tardes" : "🌙 Buenas noches");
  el.innerHTML = parte + ', <b>' + CONFIG.USUARIO + '</b> 👋' +
    '<span>Esta es tu app — emití fácil y rápido 💛</span>';
}
setSaludo();

restaurarSesion();   // recupera la venta a medio hacer y la última forma de pago
renderProductos();
renderCarrito();

/* Aviso simple de internet (online/offline) */
function actualizarOffline() {
  const bar = $("#offline-bar");
  if (bar) bar.style.display = navigator.onLine ? "none" : "block";
}
window.addEventListener("online", actualizarOffline);
window.addEventListener("offline", actualizarOffline);
actualizarOffline();

/* Registrar el service worker (network-first): hace la app instalable
   y siempre muestra la última versión. */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
