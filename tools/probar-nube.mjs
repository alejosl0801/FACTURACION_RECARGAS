/* =====================================================================
   Prueba EN VIVO del worker de la nube de clientes.
   Corre en GitHub Actions (con internet real). NO toca Azur ni emite
   facturas: solo verifica que guardar/leer un cliente funcione de punta
   a punta contra el worker real.

   Usa un id NO numérico ("PRUEBA-NUBE-ROBOT") para que jamás colisione
   con una cédula/RUC real ni aparezca en una búsqueda de la app.
   ===================================================================== */

const BASE = process.env.NUBE_URL || "https://nube-clientes.alejosl0801.workers.dev/";
const ID = "PRUEBA-NUBE-ROBOT";
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "✅" : "❌") + " " + m); };

const j = async (r) => { try { return await r.json(); } catch { return null; } };

(async () => {
  console.log("• Probando worker de la nube:", BASE, "\n");

  // 1) ¿Está activo el KV?
  let r = await fetch(BASE + "nube");
  let d = await j(r);
  ok(r.ok && d && d.kv === true, "GET /nube responde { kv: true } (KV enlazado)");

  // 2) Guardar un cliente de prueba
  const rec = { id: ID, tipo: "05", nombre: "CLIENTE DE PRUEBA (robot)", dir: "Calle Falsa 123",
    tel: "0999999999", cel: "", correo: "prueba@previfuego.test" };
  r = await fetch(BASE + "cliente", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec),
  });
  d = await j(r);
  ok(r.ok && d && d.ok === true, "POST /cliente guarda el cliente de prueba { ok: true }");

  // 3) Leerlo de vuelta (esto es lo que haría OTRO celular)
  await new Promise((res) => setTimeout(res, 1500));
  r = await fetch(BASE + "cliente?id=" + encodeURIComponent(ID));
  d = await j(r);
  ok(r.ok, "GET /cliente?id=... responde 200");
  ok(d && d.nombre === rec.nombre, "el nombre guardado vuelve igual ('" + (d ? d.nombre : "—") + "')");
  ok(d && d.tel === rec.tel, "el teléfono guardado vuelve igual ('" + (d ? d.tel : "—") + "')");

  // 4) Una cédula inexistente debe dar 404 (no inventa datos)
  r = await fetch(BASE + "cliente?id=NO-EXISTE-XYZ");
  ok(r.status === 404, "cliente inexistente → 404 (la app caería al SRI, correcto)");

  console.log(`\n=== RESULTADO EN VIVO: ${pass} OK / ${fail} fallos ===`);
  if (fail) process.exit(1);
  console.log("✅ La nube de clientes funciona de punta a punta, en producción.");
})().catch((e) => { console.error("✖ Error de red:", e.message); process.exit(1); });
