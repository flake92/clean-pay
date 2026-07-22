import { bffError, bffJson } from "@/backend/http/bff-response";
import type { ChangeEmailRequest } from "@/shared/remnashop/types";
import { getRequestIp, getTurnstileToken } from "@/backend/security/turnstile";
import { changeEmail } from "@/backend/auth/email-verification";
import { readBffJsonObject } from "@/backend/http/request-body";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const rawBody = (await readBffJsonObject(request)) as ChangeEmailRequest & {
      turnstileToken?: string;
      "cf-turnstile-response"?: string;
    };

    return bffJson(
      await changeEmail(rawBody, {
        token: getTurnstileToken(rawBody),
        remoteIp: getRequestIp(request),
      }),
    );
  } catch (error) {
    return bffError(error);
  }
}
