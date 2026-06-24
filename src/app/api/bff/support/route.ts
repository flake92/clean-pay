import { bffJson } from "@/lib/bff-response";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const support = getEnv().support;

  return bffJson(support);
}
