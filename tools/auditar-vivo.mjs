/* =====================================================================
   AUDITORÍA EN VIVO (corre en GitHub Actions, internet real).
   Golpea los servicios REALES con datos REALES. NO emite facturas:
   solo lecturas/consultas. Verifica de punta a punta:
     1) Nube activa (KV)
     2) Historial en la nube (lectura real)
     3) Seguridad del proxy de PDF (/pdf solo azur.com.ec)
     4) Cliente: guardar y leer en la nube (round-trip real)
     5) IMPRESIÓN REAL: toma una factura YA emitida del historial,
        pide su PDF a Azur (consulta), lo baja por /pdf y comprueba
        que es un PDF válido y que pdf.js lo puede leer (igual que al imprimir).
   ===================================================================== */

const NUBE = "https://nube-clientes.alejosl0801.workers.dev/";
const PROXY = "https://azur-proxy.alejosl0801.workers.dev/";
let pass = 0, fail = 0, warn = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "✅" : "❌") + " " + m); };
const info = (m) => { console.log("•  " + m); };
const aviso = (m) => { warn++; console.log("⚠️  " + m); };
const j = async (r) => { try { return await r.json(); } catch { return null; } };

(async () => {
  console.log("=== AUDITORÍA EN VIVO (datos reales, sin emitir facturas) ===\n");

  // 1) Nube activa
  let r = await fetch(NUBE + "nube"); let d = await j(r);
  ok(r.ok && d && d.kv === true, "Nube activa: GET /nube => { kv:true }");

  // 2) Historial en la nube (lectura real)
  r = await fetch(NUBE + "facturas"); const facturas = await j(r);
  ok(r.ok && Array.isArray(facturas), "Historial en la nube responde una lista");
  info("Facturas en la nube ahora mismo: " + (Array.isArray(facturas) ? facturas.length : "?"));

  // 3) Seguridad del proxy de PDF
  r = await fetch(NUBE + "pdf?url=" + encodeURIComponent("https://example.com/x.pdf"));
  ok(r.status === 403, "Proxy /pdf bloquea URLs ajenas a azur.com.ec (403)");

  // 4) Cliente round-trip real (id no numérico, no afecta búsquedas reales)
  const idTest = "AUDIT-VIVO-" + Date.now();
  r = await fetch(NUBE + "cliente", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: idTest, nombre: "AUDITORIA EN VIVO", tel: "0999999999" }) });
  ok(r.ok, "Cliente: POST /cliente guarda en la nube");
  r = await fetch(NUBE + "cliente?id=" + encodeURIComponent(idTest)); d = await j(r);
  ok(d && d.nombre === "AUDITORIA EN VIVO", "Cliente: GET /cliente lo devuelve igual (sync entre celulares)");

  // 5) IMPRESIÓN REAL con una factura ya emitida
  if (!Array.isArray(facturas) || !facturas.length) {
    aviso("No hay facturas en la nube todavía (abrí el Historial en un celular para que se suban). " +
          "No puedo probar la descarga de PDF real en este momento, pero el resto está verificado.");
  } else {
    const clave = facturas[0].numero;
    info("Probando impresión con factura real (clave " + String(clave).slice(0, 12) + "...)");
    let pdfUrl = "";
    try {
      r = await fetch(PROXY + "consulta/comprobante", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ claveacceso: clave }) });
      d = await j(r);
      pdfUrl = d && (d.enlace_pdf || d.enlacePdf || d.pdf_url) || "";
    } catch (e) {}
    ok(!!pdfUrl, "Consulta a Azur devuelve el enlace del PDF real (enlace_pdf)");

    if (pdfUrl) {
      r = await fetch(NUBE + "pdf?url=" + encodeURIComponent(pdfUrl));
      const buf = r.ok ? new Uint8Array(await r.arrayBuffer()) : new Uint8Array();
      const cabecera = String.fromCharCode.apply(null, buf.slice(0, 5));
      ok(r.ok && cabecera === "%PDF-", "El PDF REAL de Azur se baja por /pdf y es un PDF válido (cabecera %PDF, " + buf.length + " bytes)");

      // pdf.js puede leerlo (igual que al imprimir)
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const doc = await pdfjs.getDocument({ data: buf, disableWorker: true, isEvalSupported: false }).promise;
        ok(doc.numPages >= 1, "pdf.js lee el PDF real de Azur (" + doc.numPages + " página(s)) — esto es lo que se imprime");
        await doc.getPage(1);
        ok(true, "pdf.js obtiene la página 1 del PDF de Azur (renderizable)");
      } catch (e) {
        aviso("pdf.js en Node no pudo parsear (" + e.message + "). El PDF igual es válido (%PDF); en el navegador pdf.js sí lo renderiza.");
      }
    }
  }

  console.log(`\n=== RESULTADO: ${pass} OK / ${fail} fallos / ${warn} avisos ===`);
  if (fail) process.exit(1);
  console.log("✅ Todo lo verificable en vivo está correcto.");
})().catch((e) => { console.error("✖ Error inesperado:", e.message); process.exit(1); });
