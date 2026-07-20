import { bffError, bffJson } from "@/backend/http/bff-response";
import { finishPasskeyRegistration } from "@/backend/auth/passkeys";
import { readBffJsonObject } from "@/backend/http/request-body";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await readBffJsonObject(request, { maxBytes: 128 * 1024 }) as unknown as RegistrationResponseJSON & { name?: string };
    return bffJson(await finishPasskeyRegistration(body));
  } catch (error) {
    return bffError(error);
  }
}
