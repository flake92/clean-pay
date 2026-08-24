"use server";

import { revalidatePath } from "next/cache";

import {
  changeProfileEmail,
  changeProfilePassword,
  requestProfileEmailVerification,
} from "@/application/profile/execute-profile-command";
import { productionProfileCommands } from "@/backend/integrations/profile/profile-adapter";
import { productionEmailVerificationCommands } from "@/backend/integrations/auth/email-verification";
import { updateEmailReminderPreference } from "@/application/profile/update-email-reminder-preference";
import { productionEmailReminderPreferenceCommands } from "@/backend/integrations/profile/email-reminder-preferences-adapter";

export async function requestProfileEmailVerificationAction(input: { email?: string; turnstileToken?: string }) {
  return requestProfileEmailVerification(productionEmailVerificationCommands, input);
}

export async function changeProfileEmailAction(input: { email: string; turnstileToken?: string }) {
  const result = await changeProfileEmail(productionEmailVerificationCommands, input);
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function changeProfilePasswordAction(input: { currentPassword: string; newPassword: string }) {
  return changeProfilePassword(productionProfileCommands, input);
}

export async function updateEmailReminderPreferenceAction(enabled: unknown) {
  const result = await updateEmailReminderPreference(
    productionEmailReminderPreferenceCommands,
    enabled,
  );
  if (result.ok) revalidatePath("/profile");
  return result;
}
