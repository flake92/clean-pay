import { bffJson } from "@/backend/http/bff-response";

export const runtime = "nodejs";

export async function POST() {
  return bffJson(
    { accepted: false, replacement: "/api/bff/auth/email/start" },
    { status: 410 },
  );
}
