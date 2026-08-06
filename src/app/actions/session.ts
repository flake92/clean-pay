"use server";

import { redirect } from "next/navigation";

import { productionCabinetCommands } from "@/backend/integrations/cabinet/cabinet-commands";

export async function clearSessionAction() {
  try {
    await productionCabinetCommands.logout();
    return { status: "success" as const };
  } catch {
    return { status: "error" as const, message: "Не удалось завершить сессию." };
  }
}

export async function logoutAction() {
  await productionCabinetCommands.logout();
  redirect("/login");
}
