/* Service worker "network-first": hace que la app sea instalable como PWA,
   pero SIEMPRE sirve la última versión desde internet (nunca una copia vieja).
   Solo guarda una copia de respaldo para poder abrir sin conexión. */
const CACHE = "recargas-net-v17";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  // borrar cachés viejas
  const ks = await caches.keys();
  await Promise.all(ks.map((k) => (k === CACHE ? null : caches.delete(k))));
  await self.clients.claim();
  // recargar SOLO las ventanas abiertas para que tomen la versión nueva
  const cls = await self.clients.matchAll({ type: "window" });
  for (const c of cls) { try { await c.navigate(c.url); } catch (e) {} }
})()));

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // no tocar emisión/consultas (POST, etc.)

  event.respondWith(
    fetch(req)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(req))
  );
});
