import { bffError, bffJson } from "@/backend/http/bff-response";
import { getPublicPlans } from "@/backend/plans/public-plans";

export const runtime = "nodejs";

export async function GET() {
  try {
    return bffJson(await getPublicPlans());
  } catch (error) {
    return bffError(error);
  }
}
