import { brandIcons } from "@/app/_composition/brand-assets";
import { serviceWorkerSource } from "@/shared/pwa/service-worker";

export const dynamic = "force-dynamic";

export async function GET() {
  const buildId = process.env.CLEAN_PAY_BUILD_ID;

  if (!buildId) {
    return new Response("Service worker build ID is unavailable", {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  const icons = brandIcons();
  return new Response(serviceWorkerSource(buildId, {
    icon: icons.icon192,
    badge: icons.icon192,
  }), {
    headers: {
      "cache-control": "no-cache, no-store, must-revalidate",
      "content-type": "application/javascript; charset=utf-8",
      "service-worker-allowed": "/",
    },
  });
}
