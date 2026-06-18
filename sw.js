/* Service worker de auto-limpieza.
   Borra cualquier caché viejo, se desregistra y recarga las pestañas
   abiertas para que siempre se vea la última versión publicada.
   (Se quitó el cacheo: la app se sirve siempre fresca desde la red.) */
self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((c) => c.navigate(c.url));
  })());
});
