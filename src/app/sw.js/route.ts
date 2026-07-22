import { serviceWorkerSource } from "@/shared/pwa/service-worker";

export const dynamic = "force-dynamic";

export async function GET() {
  const buildId = process.env.CLEAN_PAY_BUILD_ID;

  if (!buildId) {
    return new Response("Service worker build ID is unavailable", { status: 503 });
  }

  return new Response(serviceWorkerSource(buildId), {
    headers: {
      "cache-control": "no-cache, no-store, must-revalidate",
      "content-type": "application/javascript; charset=utf-8",
      "service-worker-allowed": "/",
    },
  });
}
