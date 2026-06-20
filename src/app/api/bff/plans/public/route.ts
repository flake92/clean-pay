import { bffError, bffJson } from "@/lib/bff-response";
import { remnashopRequest } from "@/lib/remnashop/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return bffJson(await remnashopRequest("/plans/public"));
  } catch (error) {
    return bffError(error);
  }
}
