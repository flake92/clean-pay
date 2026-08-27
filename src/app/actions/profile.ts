"use server";

import { revalidatePath } from "next/cache";

import {
  changeProfileEmail,
  changeProfilePassword,
  requestProfileEmailVerification,
} from "@/application/profile/execute-profile-command";
import {
  productionEmailVerificationCommands,
  productionEmailReminderPreferenceCommands,
  productionProfileCommands,
} from "@/app/_composition/session-gateways";
import { updateEmailReminderPreference } from "@/application/profile/update-email-reminder-preference";
import {
  parseEmailActionPayload,
  parseProfilePasswordPayload,
} from "@/app/actions/runtime-payload";

const malformed = {
  ok: false as const,
  code: "VALIDATION_ERROR",
  message: "Проверьте введённые данные.",
};

export async function requestProfileEmailVerificationAction(input: { email?: string; turnstileToken?: string }) {
  const parsed = parseEmailActionPayload(input);
  return parsed
    ? requestProfileEmailVerification(productionEmailVerificationCommands, parsed)
    : malformed;
}

export async function changeProfileEmailAction(input: { email: string; turnstileToken?: string }) {
  const parsed = parseEmailActionPayload(input, { emailRequired: true });
  if (!parsed?.email) return malformed;
  const result = await changeProfileEmail(productionEmailVerificationCommands, {
    ...parsed,
    email: parsed.email,
  });
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function changeProfilePasswordAction(input: { currentPassword: string; newPassword: string }) {
  const parsed = parseProfilePasswordPayload(input);
  return parsed ? changeProfilePassword(productionProfileCommands, parsed) : malformed;
}

export async function updateEmailReminderPreferenceAction(enabled: unknown) {
  const result = await updateEmailReminderPreference(
    productionEmailReminderPreferenceCommands,
    enabled,
  );
  if (result.ok) revalidatePath("/profile");
  return result;
}
