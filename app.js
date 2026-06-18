/* =====================================================================
   Facturación Rápida de Recargas — lógica completa (vanilla JS)
   ---------------------------------------------------------------------
   Flujo:  PIN  →  Cliente + Productos  →  FACTURAR  →  Azur  →  ✅ clave
   ===================================================================== */

/* ============ CONFIGURACIÓN ============ */
const CONFIG = {
  // PIN de acceso (4 dígitos). CAMBIAR por el real antes de producción.
  PIN: "1234",

  // Proxy Cloudflare que reenvía a Azur (evita CORS y oculta el token).
  PROXY_URL: "https://azur-proxy.alejosl0801.workers.dev/",
  TOKEN: "API_1851_2064_5fcfa1b47f430",

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

/* ============ PRODUCTOS (lista fija, precios SIN IVA) ============
   ⚠️ Precios estimados — confirmar con el dueño y ajustar.            */
const PRODUCTOS = [
  { cod: "REC-PQS-05",  nombre: "Recarga 5 LBS PQS",            precio: 8.00 },
  { cod: "REC-PQS-10",  nombre: "Recarga 10 LBS PQS",           precio: 12.00 },
  { cod: "REC-PQS-20",  nombre: "Recarga 20 LBS PQS",           precio: 18.00 },
  { cod: "REC-PQS-50",  nombre: "Recarga 50 LBS PQS",           precio: 35.00 },
  { cod: "REC-CO2-05",  nombre: "Recarga 5 LBS CO2",            precio: 14.00 },
  { cod: "REC-CO2-10",  nombre: "Recarga 10 LBS CO2",           precio: 22.00 },
  { cod: "REC-CO2-20",  nombre: "Recarga 20 LBS CO2 + Carro",   precio: 38.00 },
  { cod: "REC-AGUA",    nombre: "Recarga 2.5 Gln Agua Química", precio: 10.00 },
  { cod: "INSP",        nombre: "Inspección / Mantenimiento",   precio: 5.00 }
];

/* ============ ESTADO ============ */
let pinActual = "";
let carrito = {};            // { cod: cantidad }
let formaPago = "efectivo";

/* ============ HELPERS ============ */
const $ = (sel) => document.querySelector(sel);
const money = (n) => "$" + n.toFixed(2);

function show(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(screenId).classList.add("active");
}

/* =====================================================================
   PANTALLA 1 — PIN
   ===================================================================== */
function renderPinDots() {
  const dots = $("#pin-dots").children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle("filled", i < pinActual.length);
  }
}

function pressKey(k) {
  $("#pin-error").textContent = "";
  if (k === "del") {
    pinActual = pinActual.slice(0, -1);
  } else if (pinActual.length < 4) {
    pinActual += k;
  }
  renderPinDots();

  if (pinActual.length === 4) {
    setTimeout(() => {
      if (pinActual === CONFIG.PIN) {
        pinActual = "";
        renderPinDots();
        show("#screen-main");
      } else {
        $("#pin-error").textContent = "Clave incorrecta";
        pinActual = "";
        renderPinDots();
      }
    }, 150);
  }
}

document.querySelectorAll(".key[data-key]").forEach((btn) => {
  btn.addEventListener("click", () => pressKey(btn.dataset.key));
});

$("#btn-lock").addEventListener("click", () => {
  pinActual = "";
  renderPinDots();
  show("#screen-pin");
});

/* =====================================================================
   PANTALLA 2 — Cliente
   ===================================================================== */
$("#btn-final").addEventListener("click", () => {
  $("#cliente-id").value = "9999999999999";
  $("#cliente-nombre").value = "CONSUMIDOR FINAL";
  actualizarBotonFacturar();
});

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
    .filter((p) => p.nombre.toLowerCase().includes(f))
    .forEach((p) => {
      const div = document.createElement("div");
      div.className = "prod";
      div.innerHTML = `
        <div class="prod-info">
          <div class="prod-nombre">${p.nombre}</div>
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

function agregar(cod) {
  carrito[cod] = (carrito[cod] || 0) + 1;
  renderCarrito();
}

function cambiarCantidad(cod, delta) {
  carrito[cod] = (carrito[cod] || 0) + delta;
  if (carrito[cod] <= 0) delete carrito[cod];
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
    const sub = p.precio * cant;
    subtotal += sub;

    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <div class="cart-name">${p.nombre}<small>${money(p.precio)} c/u</small></div>
      <div class="qty">
        <button data-act="menos">−</button>
        <span>${cant}</span>
        <button data-act="mas">＋</button>
      </div>
      <div class="cart-sub">${money(sub)}</div>`;
    div.querySelector('[data-act="menos"]').addEventListener("click", () => cambiarCantidad(cod, -1));
    div.querySelector('[data-act="mas"]').addEventListener("click", () => cambiarCantidad(cod, 1));
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
      precioUnitario: Number(p.precio.toFixed(2)),
      descuento: 0,
      tipo_iva: CONFIG.TIPO_IVA,
      tipoproducto: CONFIG.TIPO_PRODUCTO
    };
  });

  return {
    token: CONFIG.TOKEN,
    codigoDoc: CONFIG.CODIGO_DOC,
    establecimiento: CONFIG.EMISOR.establecimiento,
    puntoEmision: CONFIG.EMISOR.puntoEmision,
    cliente: {
      tipoIdentificacion: tipoIdentificacion(id),
      identificacion: id,
      razonSocial: $("#cliente-nombre").value.trim(),
      direccion: "S/N",
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
    const resp = await fetch(CONFIG.PROXY_URL, {
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
  $("#cliente-id").value = "";
  $("#cliente-nombre").value = "";
  $("#cliente-tel").value = "";
  $("#cliente-email").value = "";
  $("#buscar").value = "";
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
renderPinDots();
renderProductos();
renderCarrito();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
