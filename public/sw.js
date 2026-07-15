const CACHE_NAME = "clean-pay-shell-v1";
const OFFLINE_URL = "/offline";
const SHELL_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/clean-pay-icon-192.png",
  "/clean-pay-icon-512.png",
  "/clean-pay-icon-maskable-512.png",
  "/clean-pay-logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(async () => (
      await caches.match(OFFLINE_URL) ?? Response.error()
    )),
  );
});
