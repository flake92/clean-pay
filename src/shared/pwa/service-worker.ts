const cachePrefix = "clean-pay-shell-";

const shellAssets = [
  "/offline",
  "/manifest.webmanifest",
  "/clean-pay-icon-192.png",
  "/clean-pay-icon-512.png",
  "/clean-pay-icon-maskable-512.png",
  "/clean-pay-logo.png",
] as const;

function js(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function serviceWorkerSource(buildId: string) {
  const normalizedBuildId = buildId.trim();

  if (!normalizedBuildId || normalizedBuildId.length > 200) {
    throw new Error("Clean Pay build ID is invalid");
  }

  const cacheName = `${cachePrefix}${normalizedBuildId}`;

  return `const CACHE_PREFIX = ${js(cachePrefix)};
const CACHE_NAME = ${js(cacheName)};
const OFFLINE_URL = "/offline";
const SHELL_ASSETS = ${js(shellAssets)};

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(SHELL_ASSETS.map(async (url) => {
    const request = new Request(url, { cache: "reload" });
    const response = await fetch(request);
    if (!response.ok) throw new Error(\`Unable to precache \${url}: \${response.status}\`);
    await cache.put(request, response);
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(OFFLINE_URL, { ignoreSearch: true }) ?? Response.error();
  }));
});
`;
}
