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

export type ServiceWorkerIcons = {
  icon: string;
  badge: string;
};

const defaultIcons: ServiceWorkerIcons = {
  icon: "/clean-pay-icon-192.png",
  badge: "/clean-pay-icon-192.png",
};

export function serviceWorkerSource(buildId: string, icons: ServiceWorkerIcons = defaultIcons) {
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

const NOTIFICATION_ICON = ${js(icons.icon)};
const NOTIFICATION_BADGE = ${js(icons.badge)};

function notificationTarget(value) {
  try {
    const url = new URL(typeof value === "string" ? value : "/", self.location.origin);
    if (url.origin === self.location.origin || url.protocol === "https:") return url.href;
  } catch (error) {}
  return new URL("/", self.location.origin).href;
}

// Copies of bot notifications delivered by Web Push (RFC 8030).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Уведомление";
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === "string" ? data.body : "",
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    tag: typeof data.tag === "string" ? data.tag : undefined,
    data: { url: notificationTarget(data.url) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = notificationTarget(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const sameOrigin = new URL(target).origin === self.location.origin;
    if (sameOrigin) {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
`;
}
