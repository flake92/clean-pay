"use server";

import { redirect } from "next/navigation";

import {
  clearCabinetSession,
  endCabinetSession,
} from "@/application/cabinet/execute-command";
import { productionCabinetCommands } from "@/backend/integrations/cabinet/cabinet-commands";

export async function clearSessionAction() {
  return clearCabinetSession(productionCabinetCommands);
}

export async function logoutAction() {
  await endCabinetSession(productionCabinetCommands);
  redirect("/login");
}
