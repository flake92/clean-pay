"use server";

import { executeAuthCommand } from "@/application/auth/execute-auth-command";
import { productionAuthCommands } from "@/backend/integrations/auth/auth-commands";
import type { AuthCommand } from "@/application/models/auth-actions";

export async function executeAuthAction(command: AuthCommand) {
  return executeAuthCommand(productionAuthCommands, command);
}
