"use server";

import { executeAuthCommand } from "@/backend/application/auth/execute-auth-command";
import { productionAuthCommands } from "@/backend/integrations/auth/auth-commands";
import type { AuthCommand } from "@/shared/presentation/auth-actions";

export async function executeAuthAction(command: AuthCommand) {
  return executeAuthCommand(productionAuthCommands, command);
}
