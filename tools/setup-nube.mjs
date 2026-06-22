/* =====================================================================
   Robot "Activar nube de clientes"
   ---------------------------------------------------------------------
   Corre dentro de GitHub Actions (que SÍ tiene internet a Cloudflare).
   Con un token de Cloudflare (guardado como secreto de GitHub):
     1) Crea (o reutiliza) el KV namespace  CLIENTES_KV
     2) Descarga el worker que YA está desplegado (azur-proxy)
     3) Le parcha las rutas /cliente y /nube (sin tocar tus datos)
     4) Lo vuelve a subir enlazado al KV
     5) Verifica que /nube responda { kv: true }

   Los 958 clientes y el token de Azur viven dentro del worker: el robot
   los maneja en memoria y NUNCA los escribe en el repo ni en los logs.
   ===================================================================== */

const TOKEN = process.env.CF_API_TOKEN;
let ACCOUNT = process.env.CF_ACCOUNT_ID || "";
const SCRIPT_NAME = process.env.CF_WORKER_NAME || "azur-proxy";
const KV_TITLE = "CLIENTES_KV";
const API = "https://api.cloudflare.com/client/v4";
const COMPAT_DATE = "2024-09-23";

if (!TOKEN) {
  console.error("✖ Falta el secreto CF_API_TOKEN en GitHub. No puedo continuar.");
  process.exit(1);
}

const H = { Authorization: "Bearer " + TOKEN };

async function cf(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await r.json() : await r.text();
  return { ok: r.ok, status: r.status, body, headers: r.headers };
}

function fail(msg, extra) {
  console.error("✖ " + msg);
  if (extra) console.error(typeof extra === "string" ? extra : JSON.stringify(extra, null, 2));
  process.exit(1);
}

/* ---- Parche idempotente: agrega env + rutas /nube y /cliente ---- */
function parchar(code) {
  let w = code;

  // 1) pasar `env` al fetch (si no lo tiene ya)
  if (/async fetch\(request\)\s*\{/.test(w)) {
    w = w.replace("async fetch(request) {", "async fetch(request, env) {");
  }

  const yaCliente = /ruta === "cliente"/.test(w);
  const yaNube = /ruta === "nube"/.test(w);
  if (yaCliente && yaNube) return { code: w, changed: w !== code };

  const ancla = `if (ruta === "clientes") {`;
  if (!w.includes(ancla)) {
    // Worker con otra forma: insertamos antes de la primera condición de ruta.
    const alt = /(\n\s*\/\/ =+[^\n]*\n\s*if \(ruta === )/;
    if (!alt.test(w)) fail("No reconozco la estructura del worker desplegado. ¿Es el azur-proxy correcto?");
  }

  let bloque = "";
  if (!yaNube) {
    bloque += `
    // ===== Estado de la nube de clientes (¿está el KV enlazado?) =====
    if (ruta === "nube") {
      const kv = !!(env && env.CLIENTES_KV);
      return new Response(JSON.stringify({ kv }), { headers: CORS });
    }
`;
  }
  if (!yaCliente) {
    bloque += `
    // ===== Cliente individual en la nube (se sincroniza entre celulares) =====
    if (ruta === "cliente") {
      const idQ = (url.searchParams.get("id") || "").trim();
      if (request.method === "GET") {
        const fijo = (typeof CLIENTES !== "undefined" ? CLIENTES : []).find((c) => String(c.id).trim() === idQ);
        if (fijo) return new Response(JSON.stringify(fijo), { headers: CORS });
        if (env && env.CLIENTES_KV) {
          const v = await env.CLIENTES_KV.get("cli:" + idQ);
          if (v) return new Response(v, { headers: CORS });
        }
        return new Response(JSON.stringify({}), { status: 404, headers: CORS });
      }
      let rec = {};
      try { rec = JSON.parse((await request.text()) || "{}"); } catch (e) {}
      const id = String(rec.id || "").trim();
      if (!id || !rec.nombre) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: CORS });
      if (env && env.CLIENTES_KV) {
        await env.CLIENTES_KV.put("cli:" + id, JSON.stringify(rec));
        return new Response(JSON.stringify({ ok: true }), { headers: CORS });
      }
      return new Response(JSON.stringify({ ok: false, error: "KV no configurado" }), { headers: CORS });
    }
`;
  }

  // Insertar el bloque justo después del cierre del bloque "clientes".
  const idx = w.indexOf(ancla);
  const cierre = w.indexOf("}", w.indexOf("}", idx) + 1) + 1; // cierra el if(...){ return ...; }
  w = w.slice(0, cierre) + "\n" + bloque + w.slice(cierre);
  return { code: w, changed: true };
}

(async () => {
  // 1) Resolver cuenta
  if (!ACCOUNT) {
    const a = await cf("/accounts?per_page=50");
    if (!a.ok || !a.body.result || !a.body.result.length) fail("El token no puede ver ninguna cuenta de Cloudflare.", a.body);
    if (a.body.result.length > 1)
      console.log("ℹ Hay varias cuentas; uso la primera: " + a.body.result[0].name + ". (Podés fijar CF_ACCOUNT_ID si es otra.)");
    ACCOUNT = a.body.result[0].id;
  }
  console.log("• Cuenta:", ACCOUNT);

  // 2) KV namespace (crear o reutilizar)
  let nsId = "";
  const list = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100`);
  if (!list.ok) fail("No pude listar los KV. ¿El token tiene permiso 'Workers KV Storage: Edit'?", list.body);
  const existente = (list.body.result || []).find((n) => n.title === KV_TITLE);
  if (existente) { nsId = existente.id; console.log("• KV ya existía:", KV_TITLE, nsId); }
  else {
    const cr = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: KV_TITLE }),
    });
    if (!cr.ok) fail("No pude crear el KV namespace.", cr.body);
    nsId = cr.body.result.id;
    console.log("• KV creado:", KV_TITLE, nsId);
  }

  // 3) Descargar el worker desplegado
  const cont = await cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT_NAME}/content`);
  if (!cont.ok) fail(`No pude descargar el worker "${SCRIPT_NAME}". ¿El nombre es correcto y el token tiene 'Workers Scripts: Edit'?`, cont.body);

  // El contenido puede venir como JS directo o como multipart (módulos).
  let mainName = "worker.js";
  let code = "";
  const ctype = cont.headers.get("content-type") || "";
  if (ctype.includes("multipart")) {
    const text = typeof cont.body === "string" ? cont.body : "";
    const m = text.match(/filename="([^"]+)"[\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n--/);
    if (!m) fail("No pude leer el módulo del worker (multipart).");
    mainName = m[1]; code = m[2];
  } else {
    code = typeof cont.body === "string" ? cont.body : JSON.stringify(cont.body);
  }
  if (!/export\s+default/.test(code)) fail("El worker descargado no tiene el formato esperado (export default).");

  // 4) Parchar
  const { code: patched, changed } = parchar(code);
  if (!changed) console.log("• El worker ya tenía las rutas /cliente y /nube (solo aseguro el enlace KV).");
  else console.log("• Worker parchado con /cliente y /nube.");

  // 5) Subir con el binding KV
  const metadata = {
    main_module: mainName,
    compatibility_date: COMPAT_DATE,
    bindings: [{ type: "kv_namespace", name: "CLIENTES_KV", namespace_id: nsId }],
  };
  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  fd.append(mainName, new Blob([patched], { type: "application/javascript+module" }), mainName);

  const up = await fetch(`${API}/accounts/${ACCOUNT}/workers/scripts/${SCRIPT_NAME}`, {
    method: "PUT", headers: H, body: fd,
  });
  const upBody = await up.json().catch(() => ({}));
  if (!up.ok) fail("Falló la subida del worker.", upBody);
  console.log("• Worker actualizado y enlazado al KV ✓");

  // 6) Verificar
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const ver = await fetch(`https://${SCRIPT_NAME}.${(process.env.CF_WORKERS_SUBDOMAIN || "alejosl0801")}.workers.dev/nube`);
    const j = await ver.json();
    if (j && j.kv === true) console.log("\n✅ LISTO: la nube quedó ACTIVA. Los clientes nuevos se sincronizarán en todos los celulares.");
    else console.log("\n⚠ El worker respondió pero kv =", j && j.kv, "— revisá el binding. (A veces tarda 1 min en propagar.)");
  } catch (e) {
    console.log("\n• Subida OK. No pude verificar /nube desde aquí (" + e.message + "). Abrí la app: el indicador ☁️ debería ponerse verde.");
  }
})();
