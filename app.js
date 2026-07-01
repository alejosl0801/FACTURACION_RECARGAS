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
  // Worker dedicado a la nube de clientes (clientes nuevos sincronizados
  // entre todos los celulares). Lo crea el robot de GitHub Actions.
  NUBE_URL: "https://nube-clientes.alejosl0801.workers.dev/",

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
  // ====== RECARGAS ======
  // --- PQS (precio por defecto = libras × $1) ---
  { cod: "REC3PQS",   nombre: "RECARGA 3 LB PQS",    precio: 3.50,   cat: "PQS", tipo: "REC" },
  { cod: "REC5PQS",   nombre: "RECARGA 5 LB PQS",    precio: 5.00,   cat: "PQS", tipo: "REC" },
  { cod: "REC10PQS",  nombre: "RECARGA 10 LB PQS",   precio: 10.00,  cat: "PQS", tipo: "REC" },
  { cod: "REC20PQS",  nombre: "RECARGA 20 LB PQS",   precio: 18.00,  cat: "PQS", tipo: "REC" },
  // --- CO2 (precio por defecto = libras × $1) ---
  { cod: "REC5CO2",   nombre: "RECARGA 5 LB CO2",    precio: 5.00,   cat: "CO2", tipo: "REC" },
  { cod: "REC10CO2",  nombre: "RECARGA 10 LB CO2",   precio: 10.00,  cat: "CO2", tipo: "REC" },
  { cod: "REC20CO2",  nombre: "RECARGA 20 LB CO2",   precio: 18.00,  cat: "CO2", tipo: "REC" },

  // ====== VENTAS (extintores) — precio = subtotal, editable; IVA 15% se suma solo ======
  // --- PQS ---
  { cod: "VENT3PQS",  nombre: "EXTINTOR 3 LBS PQS",  precio: 13.00,  cat: "PQS", tipo: "VENTA" },
  { cod: "VENT5PQS",  nombre: "EXTINTOR 5 LBS PQS",  precio: 17.00,  cat: "PQS", tipo: "VENTA" },
  { cod: "VENT10PQS", nombre: "EXTINTOR 10 LBS PQS", precio: 24.00,  cat: "PQS", tipo: "VENTA" },
  { cod: "VENT20PQS", nombre: "EXTINTOR 20 LBS PQS", precio: 38.00,  cat: "PQS", tipo: "VENTA" },
  // --- CO2 ---
  { cod: "VENT5CO2",  nombre: "EXTINTOR 5 LBS CO2",  precio: 39.80,  cat: "CO2", tipo: "VENTA" },
  { cod: "VENT10CO2", nombre: "EXTINTOR 10 LBS CO2", precio: 52.00,  cat: "CO2", tipo: "VENTA" }
];

/* ============ ESTADO ============ */
let carrito = {};            // { cod: cantidad }
let precioUnit = {};         // { cod: precio unitario actual (editable) }
let formaPago = "efectivo";
let modoActivo = "REC";      // "REC" (recargas) o "VENTA" (ventas)
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
  sincronizarClienteNube(rec); // que aparezca también en los otros celulares
}

/* Sube el cliente a TU worker (nube) para que aparezca en CUALQUIER celular.
   Es "best effort": si el worker todavía no tiene la nube de clientes
   configurada (KV), simplemente no pasa nada y el cliente sigue guardado
   en este celular. Nunca rompe la facturación. */
function sincronizarClienteNube(rec) {
  if (!rec || !rec.id || !rec.nombre) return;
  try {
    fetch(CONFIG.NUBE_URL + "cliente", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rec)
    }).catch(() => {});
  } catch (e) {}
}

/* Pregunta al worker por un cliente que NO está en la base local
   (lo pudo haber registrado otro celular). Devuelve el registro o null. */
async function buscarClienteNube(id) {
  try {
    const r = await fetch(CONFIG.NUBE_URL + "cliente?id=" + encodeURIComponent(id));
    if (!r.ok) return null;
    const c = JSON.parse(await r.text());
    return c && c.id ? c : null;
  } catch (e) { return null; }
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

/* Auto-descarga de la base de clientes desde TU worker (nube privada).
   Así aparecen en CUALQUIER celular sin importar a mano. Si ya hay
   clientes guardados en este celular, no vuelve a descargar. */
(function () {
  let hay = 0;
  try { hay = JSON.parse(localStorage.getItem("clientes_db") || "[]").length; } catch (e) {}
  if (hay) return;
  fetch(CONFIG.PROXY_URL + "clientes")
    .then((r) => (r.ok ? r.text() : null))
    .then((t) => {
      if (!t) return;
      const arr = JSON.parse(t);
      if (Array.isArray(arr) && arr.length) {
        localStorage.setItem("clientes_db", JSON.stringify(arr));
        _clientesIndex = null;
      }
    })
    .catch(() => {});
})();

/* Indicador de NUBE: pregunta al worker si el KV está enlazado y lo
   muestra en pantalla, para saber sin adivinar si los clientes nuevos
   se están sincronizando entre celulares. Al tocarlo, explica el estado. */
(function () {
  const badge = $("#nube-badge");
  if (!badge) return;
  let estado = { kv: false, error: true };

  function pintar() {
    badge.hidden = false;
    if (estado.error) { badge.textContent = "☁️ Nube: sin conexión"; badge.className = "nube-badge off"; }
    else if (estado.kv) { badge.textContent = "☁️ Nube activa ✓"; badge.className = "nube-badge on"; }
    else { badge.textContent = "☁️ Nube: falta activar"; badge.className = "nube-badge warn"; }
  }

  function comprobar() {
    fetch(CONFIG.NUBE_URL + "nube")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { estado = { kv: !!d.kv, error: false }; pintar(); })
      .catch(() => { estado = { kv: false, error: true }; pintar(); });
  }

  badge.addEventListener("click", () => {
    if (estado.error)
      alert("No se pudo contactar la nube. Revisá el internet.\n\nSi persiste, hay que volver a pegar el worker en Cloudflare.");
    else if (estado.kv)
      alert("✅ La nube está activa.\n\nCada cliente nuevo que registres queda guardado y aparece en cualquier celular automáticamente.");
    else
      alert("⚠️ Falta activar la nube en Cloudflare (una sola vez):\n\n1) Storage & Databases → KV → Create namespace → nombre: CLIENTES_KV\n2) En el worker azur-proxy → Settings → Bindings → Add → KV namespace → variable CLIENTES_KV → elegí ese namespace.\n3) Deploy.\n\nMientras tanto la app funciona igual con el SRI.");
  });

  comprobar();
  setTimeout(comprobar, 4000); // reintento por si la primera carga falló
})();

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

/* Vuelca un registro de cliente (de la base local o de la nube) en el form */
function llenarDatosCliente(c) {
  $("#cliente-nombre").value = c.nombre || "";
  if (c.dir) $("#cliente-dir").value = c.dir;
  const tel = c.tel || c.cel || "";
  if (tel) $("#cliente-tel").value = tel;
  if (c.correo) $("#cliente-email").value = c.correo;
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
    llenarDatosCliente(local);
    setSriMsg("✓ " + (local.nombre || "Cliente") + " — está en tu base.");
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
    // 2) ¿Lo registró otro celular? Preguntamos a la nube (worker).
    const nube = await buscarClienteNube(raw);
    if (nube && nube.nombre) {
      llenarDatosCliente(nube);
      // lo dejamos también en este celular para la próxima
      const db = clientesDB();
      if (!db.some((c) => String(c.id).trim() === raw)) {
        db.push(nube); localStorage.setItem("clientes_db", JSON.stringify(db)); _clientesIndex = null;
      }
      setSriMsg("✓ " + nube.nombre + " — cliente guardado en la nube.");
      actualizarBotonFacturar();
      guardarBorrador();
      return;
    }

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

    setSriMsg("✓ " + nombre + " — datos del SRI cargados. Tel/correo no son públicos: completalos a mano si hace falta.");
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
    .filter((p) => p.tipo === modoActivo && p.cat === categoriaActiva)
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

/* selector RECARGAS / VENTAS */
document.querySelectorAll(".modo-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".modo-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    modoActivo = btn.dataset.modo;
    categoriaActiva = "PQS"; // al cambiar de modo, volver a PQS
    document.querySelectorAll(".cat-tab").forEach((b) => b.classList.toggle("active", b.dataset.cat === "PQS"));
    renderProductos();
  });
});

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
    if (!p) { delete carrito[cod]; delete precioUnit[cod]; return; }
    const cant = carrito[cod];
    const precio = precioUnit[cod];
    const sub = precio * cant;
    subtotal += sub;

    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <div class="cart-name">${p.nombre} <span class="prod-cod">${p.cod}</span>
        <small class="precio-edit">$ <input type="text" inputmode="decimal" step="0.01" min="0"
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
      let v = parseFloat(inp.value.replace(",", "."));
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

  // El botón muestra el monto a facturar
  let total = 0;
  Object.keys(carrito).forEach((c) => { total += (precioUnit[c] || 0) * carrito[c]; });
  total *= (1 + CONFIG.IVA);
  $("#btn-facturar").textContent = total > 0 ? "FACTURAR  " + money(total) : "FACTURAR";

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

let emitiendo = false;   // evita doble emisión por doble toque
let ultimaClave = "";    // clave de acceso de la última factura emitida
let ultimaFirma = "";    // firma de la última venta emitida (anti-duplicado)
let ultimaVenta = {};    // datos de la última venta (para WhatsApp)

function firmaVenta(ctx) {
  return ctx.cli.id + "|" + ctx.total.toFixed(2) + "|" +
    Object.keys(carrito).sort().map((c) => c + "x" + carrito[c]).join(",");
}

async function facturar() {
  if (emitiendo) return;
  const ctx = contextoVenta();

  // Seguridad: total en $0
  if (ctx.total <= 0) { alert("El total es $0. Revisá los precios o agregá un producto."); return; }
  // Aviso si la cédula/RUC parece tener un error de tipeo
  if (identificacionSospechosa(ctx.cli.id)) {
    if (!window.confirm("La cédula/RUC parece tener un error. ¿Emitir de todos modos?")) return;
  }
  // Aviso anti-duplicado: misma venta que la anterior
  if (firmaVenta(ctx) === ultimaFirma) {
    if (!window.confirm("Ya emitiste una factura igual recién (mismo cliente y productos). ¿Emitir otra?")) return;
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
    ultimaFirma = firmaVenta(ctx);
    ultimaVenta = { nombre: ctx.cli.nombre, tel: ctx.cli.tel, total: ctx.total };
    vibrar([60, 40, 120]);
    if (exito) celebrar();
    mostrarFacturaAzur(clave, yaEmitida); // muestra el PDF REAL de Azur en pantalla
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

/* Traduce el error técnico de Azur a algo que Fabiola entienda */
function errorAmigable(msg) {
  const m = (msg || "").toLowerCase();
  if (/registrad/.test(m)) return "Esta factura ya estaba emitida.";
  if (/secuencial|numerac/.test(m)) return "Problema con la numeración. Intentá de nuevo.";
  if (/api_?key|autoriz|token|llave/.test(m)) return "Problema de configuración. Avisá al administrador.";
  if (/saldo|cr[eé]dito|plan|comprobantes disponibles/.test(m)) return "Sin saldo en Azur. Hay que recargar el plan.";
  if (/cliente|comprador|identif|raz[oó]n/.test(m)) return "Faltan datos del cliente. Completalos e intentá de nuevo.";
  if (/json|conex|tiempo|timeout/.test(m)) return "No se pudo conectar con Azur. Revisá el internet e intentá de nuevo.";
  return msg || "No se pudo emitir. Intentá de nuevo.";
}

/* Si Azur NO autorizó: mostrar el/los motivo(s) de forma clara */
function renderRespuesta(data) {
  const crudo = mensajeError(data);
  const amigable = errorAmigable(crudo);
  $("#comprobante").innerHTML =
    '<div class="ride" style="padding:18px;text-align:center">' +
      '<div style="font-size:46px">⚠️</div>' +
      '<div class="ride-tipo" style="color:#c0392b;font-size:20px;justify-content:center">No se pudo emitir</div>' +
      '<p style="margin:10px 0;font-size:17px;color:#000;font-weight:700">' + escapeHtml(amigable) + '</p>' +
      (crudo && crudo !== amigable ? '<p style="font-size:11px;color:#999">(' + escapeHtml(crudo) + ')</p>' : '') +
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
      if (/^https?:\/\//.test(s) && /pdf|ride|comprobante|descargaryver/i.test(s)) { res = { tipo: "url", valor: s }; return; }
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
    imprimirArrayBuffer(bytes.buffer, URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
    return true;
  } catch (e) { return false; }
}

/* Dibuja el PDF REAL de Azur dentro de la página (con pdf.js) y manda a
   imprimir SOLO ese PDF (oculta todo lo demás). Así lo que sale por la
   impresora es idéntico al de Azur, no la vista de la app.
   Si pdf.js no está disponible, abre/descarga el PDF como respaldo. */
/* Dibuja todas las páginas de un PDF (ArrayBuffer) como imágenes dentro de
   un elemento. Usa una copia del buffer para no inutilizar el original. */
async function renderPdfEn(contenedor, buf) {
  if (!window.pdfjsLib) return false;
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  contenedor.innerHTML = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    // Importante: convertir el canvas a IMAGEN. El Safari del iPhone NO imprime
    // los <canvas> (salen en blanco); las imágenes sí se imprimen siempre.
    const img = document.createElement("img");
    img.style.display = "block";
    img.style.maxWidth = "100%";
    const dataUrl = canvas.toDataURL("image/png");
    // Esperar a que la imagen esté REALMENTE cargada antes de seguir, para que
    // nunca se imprima en blanco (carrera de tiempos en el iPhone).
    await new Promise((resolve) => {
      img.onload = resolve;
      img.onerror = resolve;
      img.src = dataUrl;
      // por si onload no dispara (cache/decode), reintento con decode y un tope
      if (img.decode) { img.decode().then(resolve).catch(() => {}); }
      setTimeout(resolve, 3000);
    });
    contenedor.appendChild(img);
  }
  return true;
}

async function imprimirArrayBuffer(buf, blobUrl) {
  // iOS Safari: abrir el PDF directo en el visor nativo de Safari.
  // Así se imprime sin encabezados del navegador (URL, fecha), a tamaño real,
  // y sin los bugs de canvas→image→window.print().
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    if (!blobUrl && buf) {
      blobUrl = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
    }
    if (blobUrl) { window.open(blobUrl, "_blank"); return; }
  }

  const area = document.getElementById("print-area");
  if (window.pdfjsLib && area) {
    try {
      if (!(await renderPdfEn(area, buf))) throw new Error("sin pdfjs");
      const ocultos = [];
      Array.prototype.forEach.call(document.body.children, (el) => {
        if (el !== area && el.style.display !== "none") {
          ocultos.push([el, el.style.display]);
          el.style.display = "none";
        }
      });
      area.style.display = "block";
      document.body.classList.add("printing");

      let restaurado = false;
      const restaurar = () => {
        if (restaurado) return;
        restaurado = true;
        document.body.classList.remove("printing");
        area.style.display = "none";
        area.innerHTML = "";
        ocultos.forEach(([el, d]) => { el.style.display = d; });
      };
      try { window.addEventListener("afterprint", restaurar, { once: true }); } catch (e) {}
      setTimeout(restaurar, 120000);

      await new Promise((r) => setTimeout(r, 250));
      window.print();
      return;
    } catch (e) { /* cae al respaldo */ }
  }
  if (blobUrl) window.open(blobUrl, "_blank");
}

/* Trae el PDF de Azur por el worker (con CORS) y lo manda a imprimir.
   Si algo falla, abre el PDF en una pestaña (respaldo). */
async function imprimirPdfUrl(pdfUrl) {
  try {
    const r = await fetch(CONFIG.NUBE_URL + "pdf?url=" + encodeURIComponent(pdfUrl));
    if (r.ok) {
      const buf = await r.arrayBuffer();
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
      await imprimirArrayBuffer(buf.slice(0), blobUrl);
      return;
    }
  } catch (e) {}
  window.open(pdfUrl, "_blank"); // respaldo
}

/* Consulta a Azur por una clave y devuelve el enlace del PDF (o ""). */
async function enlacePdfDeClave(clave) {
  try {
    const r = await fetch(CONFIG.PROXY_URL + "consulta/comprobante", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claveacceso: clave })
    });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch (e) { d = null; }
    let url = (d && (d.enlace_pdf || d.enlacePdf || d.pdf_url)) || "";
    if (!url) { const f = d && buscarPdf(d); if (f && f.tipo === "url") url = f.valor; }
    return url;
  } catch (e) { return ""; }
}

/* Tras emitir: muestra en pantalla el PDF REAL de Azur (no una versión dibujada).
   Guarda el PDF en memoria para que IMPRIMIR sea instantáneo. */
let ultimoPdfBuf = null;
async function mostrarFacturaAzur(clave, yaEmitida) {
  const cont = $("#comprobante");
  ultimoPdfBuf = null;
  cont.innerHTML =
    '<div class="estado-ok no-print">' +
      (yaEmitida ? "✅ Esta factura ya estaba emitida" : "✅ ¡Bien hecho, " + CONFIG.USUARIO + "! Factura lista 🎉") +
    '</div>' +
    '<div id="factura-pdf" class="factura-pdf"><p class="cargando-pdf">Cargando tu factura de Azur…</p></div>';
  const destino = document.getElementById("factura-pdf");
  try {
    const url = await enlacePdfDeClave(clave);
    if (!url) throw new Error("sin enlace");
    const pr = await fetch(CONFIG.NUBE_URL + "pdf?url=" + encodeURIComponent(url));
    if (!pr.ok) throw new Error("sin pdf");
    const buf = await pr.arrayBuffer();
    ultimoPdfBuf = buf.slice(0);
    if (!(await renderPdfEn(destino, buf))) throw new Error("sin pdfjs");
  } catch (e) {
    destino.innerHTML =
      '<div class="aviso-pdf">Tu factura ya está <b>emitida y autorizada</b> por el SRI.<br>' +
      'Clave de acceso:<br><b style="word-break:break-all">' + escapeHtml(clave || "") + '</b><br><br>' +
      'Si no se muestra acá, tocá <b>🖨️ IMPRIMIR</b> para abrir el PDF de Azur.</div>';
  }
}

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
    if (pdfUrl) { await imprimirPdfUrl(pdfUrl); return; }
    // Respaldo: buscar PDF en cualquier forma; si no, imprimir la vista
    const found = d && buscarPdf(d);
    if (found && found.tipo === "url") { await imprimirPdfUrl(found.valor); return; }
    if (found && found.tipo === "base64" && abrirPdfBase64(found.valor)) return;
  } catch (e) { /* sin conexión → imprime la vista */ }
  window.print();
}

$("#btn-imprimir").addEventListener("click", () => {
  if (ultimoPdfBuf) {
    const blob = new Blob([ultimoPdfBuf], { type: "application/pdf" });
    imprimirArrayBuffer(ultimoPdfBuf.slice(0), URL.createObjectURL(blob));
    return;
  }
  abrirPdfDeAzur(ultimaClave);
});

/* Enviar la factura por WhatsApp a un número que se escribe en el momento
   (puede ser distinto al teléfono del cliente). Manda el link del PDF de Azur. */
$("#btn-wpp").addEventListener("click", async () => {
  const sugerido = (ultimaVenta.tel || "").replace(/\D/g, "");
  let num = window.prompt("¿A qué número de WhatsApp envío la factura? (ej: 0991234567)", sugerido);
  if (num === null) return;
  num = num.replace(/\D/g, "");
  if (!num) { alert("Escribí un número de WhatsApp."); return; }
  if (num.charAt(0) === "0") num = "593" + num.slice(1);      // 09... → 5939...
  else if (num.length === 9) num = "593" + num;               // 9... → 5939...
  let link = "";
  try {
    const r = await fetch(CONFIG.PROXY_URL + "consulta/comprobante", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claveacceso: ultimaClave })
    });
    const d = JSON.parse(await r.text());
    link = d.enlace_pdf || "";
  } catch (e) { /* sin link, mando solo el texto */ }
  const msg = "Hola " + (ultimaVenta.nombre || "") + ", aquí está su factura de PREVIFUEGO" +
    (link ? ": " + link : ". Le llegará también por correo.");
  window.open("https://wa.me/" + num + "?text=" + encodeURIComponent(msg), "_blank");
});

/* =====================================================================
   HISTORIAL — últimas 20 facturas, con reimpresión (abre el PDF de Azur)
   ===================================================================== */
function leerLogLocal() {
  try { return JSON.parse(localStorage.getItem("comprobantes_log") || "[]"); } catch (e) { return []; }
}
/* Une las facturas de la nube con las locales, sin duplicar (por número),
   ordenadas de la más nueva a la más vieja. */
function unirFacturas(nube, local) {
  const vistos = {}, out = [];
  [].concat(nube || [], local || []).forEach((f) => {
    if (!f || !f.numero || vistos[f.numero]) return;
    vistos[f.numero] = 1; out.push(f);
  });
  out.sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  return out;
}

function renderHistorial() {
  // 1) Pinta al instante lo local (rápido), y guarda lo de la nube cuando llegue.
  pintarHistorial(leerLogLocal());
  fetch(CONFIG.NUBE_URL + "facturas")
    .then((r) => (r.ok ? r.json() : null))
    .then((nube) => {
      if (!Array.isArray(nube)) return;
      const local = leerLogLocal();
      // Subir a la nube las facturas que están solo en ESTE celular
      // (p. ej. emitidas antes de tener la nube), para que se vean en todos.
      const enNube = {};
      nube.forEach((f) => { if (f && f.numero) enNube[f.numero] = 1; });
      local.forEach((f) => { if (f && f.numero && !enNube[f.numero]) sincronizarFacturaNube(f); });

      const unidas = unirFacturas(nube, local);
      // Deja el historial unificado también guardado en este celular.
      try { localStorage.setItem("comprobantes_log", JSON.stringify(unidas.slice(0, 100))); } catch (e) {}
      pintarHistorial(unidas);
    })
    .catch(() => {});
}

function pintarHistorial(log) {
  const cont = $("#lista-historial");
  if (!log || !log.length) {
    cont.innerHTML = '<p style="text-align:center;color:#7f8c8d;padding:24px">Todavía no hay facturas emitidas.</p>';
    return;
  }
  cont.innerHTML = "";
  let abriendo = false;
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
      '<span class="hist-print">🖨️</span>';
    const abrir = async () => {
      if (abriendo) return;
      abriendo = true;
      $("#loading").querySelector("p").textContent = "Abriendo factura...";
      $("#loading").classList.add("active");
      try { await abrirPdfDeAzur(fac.numero); } catch (e) {}
      $("#loading").classList.remove("active");
      $("#loading").querySelector("p").textContent = "Emitiendo factura...";
      abriendo = false;
    };
    div.addEventListener("click", abrir);
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
    const registro = {
      fecha: new Date().toISOString(),
      numero: numProv,
      cliente: cli.nombre,
      identificacion: cli.id,
      direccion: cli.dir,
      telefono: cli.tel,
      email: cli.email,
      total: Number(total.toFixed(2)),
      items: items
    };
    const log = JSON.parse(localStorage.getItem("comprobantes_log") || "[]");
    log.unshift(registro);
    localStorage.setItem("comprobantes_log", JSON.stringify(log.slice(0, 100)));
    sincronizarFacturaNube(registro); // que aparezca en todos los celulares
  } catch (e) { /* ignore */ }
}

/* Sube la factura al historial de la nube (best effort: si la nube no está
   configurada, no pasa nada y el historial sigue local en este celular). */
function sincronizarFacturaNube(registro) {
  if (!registro || !registro.numero) return;
  try {
    fetch(CONFIG.NUBE_URL + "factura", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registro)
    }).catch(() => {});
  } catch (e) {}
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
  const subs = [
    "Esta es tu app — emití fácil y rápido 💛",
    "Que tengas un gran día 🌟",
    "Vamos con esas facturas 💪",
    "Sos la mejor, " + CONFIG.USUARIO + " 💖"
  ];
  const sub = subs[Math.floor(Math.random() * subs.length)];
  el.innerHTML = parte + ', <b>' + CONFIG.USUARIO + '</b> 👋<span>' + sub + '</span>';
}
setSaludo();

/* Onboarding: bienvenida la primera vez */
(function () {
  if (localStorage.getItem("onboard")) return;
  const ob = $("#onboarding");
  if (!ob) return;
  ob.classList.add("active");
  $("#onb-ok").addEventListener("click", () => {
    localStorage.setItem("onboard", "1");
    ob.classList.remove("active");
  });
})();

/* Mini celebración al emitir */
function celebrar() {
  const cont = document.createElement("div");
  cont.className = "confeti";
  const ems = ["🎉", "✨", "🎊", "🔥", "⭐"];
  for (let i = 0; i < 14; i++) {
    const s = document.createElement("span");
    s.textContent = ems[i % ems.length];
    s.style.left = Math.random() * 100 + "%";
    s.style.animationDelay = (Math.random() * 0.3).toFixed(2) + "s";
    s.style.fontSize = (16 + Math.random() * 16).toFixed(0) + "px";
    cont.appendChild(s);
  }
  document.body.appendChild(cont);
  setTimeout(() => cont.remove(), 2200);
}

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
  navigator.serviceWorker.register("sw.js?v=17", { updateViaCache: "none" }).then((reg) => {
    try { reg.update(); } catch (e) {}
    setInterval(() => { try { reg.update(); } catch (e) {} }, 60000);
  }).catch(() => {});
}
