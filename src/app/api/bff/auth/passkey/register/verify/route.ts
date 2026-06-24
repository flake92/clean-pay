import { bffError, bffJson } from "@/lib/bff-response";
import { finishPasskeyRegistration } from "@/server/auth/passkeys";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return bffJson(await finishPasskeyRegistration(await request.json()));
  } catch (error) {
    return bffError(error);
  }
}
