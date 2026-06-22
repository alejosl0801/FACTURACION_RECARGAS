/* =====================================================================
   Robot "Activar nube de clientes"  (worker dedicado)
   ---------------------------------------------------------------------
   Corre en GitHub Actions. Con un token de Cloudflare:
     1) Resuelve la cuenta
     2) Crea (o reutiliza) el KV namespace  CLIENTES_KV
     3) SUBE un worker pequeño y nuevo: "nube-clientes"  (enlazado al KV)
     4) Le activa el subdominio workers.dev
     5) Verifica que responda  { kv: true }

   NO toca el worker de facturación (azur-proxy). El worker de la nube no
   contiene secretos ni datos: solo guarda/lee clientes en el KV. Por eso
   su código puede vivir tranquilo acá en el repo.

   Token necesario (secreto CF_API_TOKEN):
     - Workers Scripts: Edit
     - Workers KV Storage: Edit
   ===================================================================== */

const TOKEN = process.env.CF_API_TOKEN;
let ACCOUNT = process.env.CF_ACCOUNT_ID || "";
const WORKER = process.env.CF_NUBE_WORKER || "nube-clientes";
const KV_TITLE = "CLIENTES_KV";
const API = "https://api.cloudflare.com/client/v4";
const COMPAT_DATE = "2024-09-23";

if (!TOKEN) { console.error("✖ Falta el secreto CF_API_TOKEN en GitHub."); process.exit(1); }
const H = { Authorization: "Bearer " + TOKEN };

async function cf(path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await r.json() : await r.text();
  return { ok: r.ok, status: r.status, body };
}
function fail(msg, extra) {
  console.error("✖ " + msg);
  if (extra) console.error(typeof extra === "string" ? extra : JSON.stringify(extra, null, 2));
  process.exit(1);
}

/* Código del worker de la nube (sin secretos, sin datos) */
const WORKER_CODE = `export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ruta = url.pathname.replace(/^\\//, "");
    const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type" } });
    }
    if (ruta === "nube") {
      return new Response(JSON.stringify({ kv: !!(env && env.CLIENTES_KV) }), { headers: CORS });
    }
    if (ruta === "pdf") {
      // Reenvía el PDF de Azur con cabeceras CORS, para poder imprimirlo
      // directo desde la app. Solo permite URLs de azur.com.ec (seguridad).
      const target = url.searchParams.get("url") || "";
      let host = "";
      try { host = new URL(target).hostname; } catch (e) {}
      if (!/(^|\\.)azur\\.com\\.ec$/i.test(host)) {
        return new Response('{"error":"url no permitida"}', { status: 403, headers: CORS });
      }
      const pr = await fetch(target);
      const buf = await pr.arrayBuffer();
      return new Response(buf, { headers: {
        "Content-Type": "application/pdf",
        "Access-Control-Allow-Origin": "*",
        "Content-Disposition": "inline; filename=\\"factura.pdf\\"" } });
    }
    if (ruta === "cliente") {
      const idQ = (url.searchParams.get("id") || "").trim();
      if (request.method === "GET") {
        if (env && env.CLIENTES_KV) {
          const v = await env.CLIENTES_KV.get("cli:" + idQ);
          if (v) return new Response(v, { headers: CORS });
        }
        return new Response("{}", { status: 404, headers: CORS });
      }
      let rec = {};
      try { rec = JSON.parse((await request.text()) || "{}"); } catch (e) {}
      const id = String(rec.id || "").trim();
      if (!id || !rec.nombre) return new Response('{"ok":false}', { status: 400, headers: CORS });
      if (env && env.CLIENTES_KV) {
        await env.CLIENTES_KV.put("cli:" + id, JSON.stringify(rec));
        return new Response('{"ok":true}', { headers: CORS });
      }
      return new Response('{"ok":false,"error":"KV no configurado"}', { headers: CORS });
    }
    return new Response("{}", { headers: CORS });
  }
};`;

(async () => {
  // 1) Cuenta
  if (!ACCOUNT) {
    const a = await cf("/accounts?per_page=50");
    if (!a.ok || !a.body.result || !a.body.result.length) fail("El token no ve ninguna cuenta.", a.body);
    ACCOUNT = a.body.result[0].id;
  }
  console.log("• Cuenta:", ACCOUNT);

  // 2) KV (crear o reutilizar)
  let nsId = "";
  const list = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces?per_page=100`);
  if (!list.ok) fail("No pude listar KV. ¿El token tiene 'Workers KV Storage: Edit'?", list.body);
  const ex = (list.body.result || []).find((n) => n.title === KV_TITLE);
  if (ex) { nsId = ex.id; console.log("• KV reutilizado:", nsId); }
  else {
    const cr = await cf(`/accounts/${ACCOUNT}/storage/kv/namespaces`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: KV_TITLE }),
    });
    if (!cr.ok) fail("No pude crear el KV.", cr.body);
    nsId = cr.body.result.id; console.log("• KV creado:", nsId);
  }

  // 3) Subir el worker de la nube con el binding al KV
  const metadata = {
    main_module: "worker.js",
    compatibility_date: COMPAT_DATE,
    bindings: [{ type: "kv_namespace", name: "CLIENTES_KV", namespace_id: nsId }],
  };
  const fd = new FormData();
  fd.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  fd.append("worker.js", new Blob([WORKER_CODE], { type: "application/javascript+module" }), "worker.js");
  const up = await fetch(`${API}/accounts/${ACCOUNT}/workers/scripts/${WORKER}`, { method: "PUT", headers: H, body: fd });
  const upBody = await up.json().catch(() => ({}));
  if (!up.ok) fail("No pude subir el worker de la nube. ¿El token tiene 'Workers Scripts: Edit'?", upBody);
  console.log("• Worker de la nube subido y enlazado al KV ✓");

  // 4) Activar el subdominio workers.dev del worker
  const sub = await cf(`/accounts/${ACCOUNT}/workers/scripts/${WORKER}/subdomain`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  if (!sub.ok) console.log("⚠ No pude activar el subdominio automáticamente (puede que ya esté activo).");
  else console.log("• Subdominio workers.dev activado.");

  // ¿Cuál es el subdominio de la cuenta? (para armar la URL pública)
  let subdomain = process.env.CF_WORKERS_SUBDOMAIN || "";
  if (!subdomain) {
    const s = await cf(`/accounts/${ACCOUNT}/workers/subdomain`);
    if (s.ok && s.body.result && s.body.result.subdomain) subdomain = s.body.result.subdomain;
  }
  const publicUrl = subdomain ? `https://${WORKER}.${subdomain}.workers.dev/` : "(subdominio desconocido)";
  console.log("• URL del worker de la nube:", publicUrl);

  // 5) Verificar
  if (subdomain) {
    await new Promise((r) => setTimeout(r, 4000));
    try {
      const ver = await fetch(publicUrl + "nube");
      const j = await ver.json();
      if (j && j.kv === true) console.log("\n✅ LISTO: la nube quedó ACTIVA en " + publicUrl);
      else console.log("\n⚠ Respondió pero kv =", j && j.kv, "(puede tardar 1 min en propagar).");
    } catch (e) {
      console.log("\n• Subida OK. No pude verificar desde aquí (" + e.message + "). Probá la URL en 1 min.");
    }
  }
  console.log("\nURL_NUBE=" + publicUrl);
})();
