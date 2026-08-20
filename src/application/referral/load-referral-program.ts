import type { ReferralProgramViewModel } from "@/application/models/referral";
import {
  ReferralProgramAccessError,
  type ReferralProgramReader,
} from "@/application/referral/ports/referral-program-reader";

export async function loadReferralProgram(
  reader: ReferralProgramReader,
): Promise<ReferralProgramViewModel> {
  try {
    const program = await reader.loadProgram();
    if (!program.enabled) {
      return { status: "error", message: "Реферальная программа сейчас отключена." };
    }
    return { status: "ready", program };
  } catch (error) {
    if (error instanceof ReferralProgramAccessError) {
      switch (error.reason) {
        case "unauthorized":
          return {
            status: "error",
            message: "Войдите в аккаунт, чтобы открыть реферальную программу.",
            action: "login",
          };
        case "email-required":
          return {
            status: "error",
            message: "Подтвердите e-mail, чтобы участвовать в реферальной программе.",
            action: "verify-email",
          };
        case "subscription-required":
          return {
            status: "error",
            message: "Реферальная программа доступна пользователям с активной подпиской.",
            action: "tariffs",
          };
        case "disabled":
          return { status: "error", message: "Реферальная программа сейчас отключена." };
        case "unavailable":
          break;
      }
    }

    return {
      status: "error",
      message: "Не удалось загрузить реферальную программу. Попробуйте позже.",
    };
  }
}
