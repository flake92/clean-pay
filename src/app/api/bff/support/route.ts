import { bffJson } from "@/lib/bff-response";
import { getEnv } from "@/lib/env";
import { isMockMode, mockSupport } from "@/lib/mock-bff";

export const runtime = "nodejs";

export async function GET() {
  if (isMockMode()) {
    return bffJson(mockSupport);
  }

  const support = getEnv().support;

  return bffJson(support);
}
