import { bffJson } from "@/backend/http/bff-response";
import { getEnv } from "@/backend/config/env";

export const runtime = "nodejs";

export async function GET() {
  const support = getEnv().support;

  return bffJson(support);
}
