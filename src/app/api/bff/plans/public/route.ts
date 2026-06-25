import { bffError, bffJson } from "@/backend/http/bff-response";
import { remnashopRequest } from "@/backend/integrations/remnashop/client";

export const runtime = "nodejs";

export async function GET() {
  try {
    return bffJson(await remnashopRequest("/plans/public"));
  } catch (error) {
    return bffError(error);
  }
}
