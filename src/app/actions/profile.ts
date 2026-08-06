"use server";

import { revalidatePath } from "next/cache";

import {
  changeProfileEmail,
  changeProfilePassword,
  requestProfileEmailVerification,
} from "@/backend/application/profile/execute-profile-command";
import { productionProfileCommands } from "@/backend/integrations/profile/profile-adapter";

export async function requestProfileEmailVerificationAction(input: { email?: string; turnstileToken?: string }) {
  return requestProfileEmailVerification(productionProfileCommands, input);
}

export async function changeProfileEmailAction(input: { email: string; turnstileToken?: string }) {
  const result = await changeProfileEmail(productionProfileCommands, input);
  if (result.ok) revalidatePath("/profile");
  return result;
}

export async function changeProfilePasswordAction(input: { currentPassword: string; newPassword: string }) {
  return changeProfilePassword(productionProfileCommands, input);
}
