"use server";

import { redirect } from "next/navigation";

import {
  clearCabinetSession,
  endCabinetSession,
} from "@/application/cabinet/execute-command";
import { productionCabinetCommands } from "@/app/_composition/session-gateways";
import { clearReferralAttributionCookie } from "@/app/_composition/action-runtime";

export async function clearSessionAction() {
  return clearCabinetSession(productionCabinetCommands);
}

export async function logoutAction() {
  await endCabinetSession(productionCabinetCommands);
  // Also remove attribution created by an older application version or an
  // interrupted auth flow, so a later account on this browser cannot inherit it.
  await clearReferralAttributionCookie();
  redirect("/login");
}
