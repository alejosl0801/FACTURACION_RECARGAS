/* Service worker "network-first": hace que la app sea instalable como PWA,
   pero SIEMPRE sirve la última versión desde internet (nunca una copia vieja).
   Solo guarda una copia de respaldo para poder abrir sin conexión. */
const CACHE = "recargas-net-v11";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

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
