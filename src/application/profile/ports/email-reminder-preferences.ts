import type { EmailReminderPreferenceViewModel } from "@/application/models/profile";

export interface EmailReminderPreferenceReader {
  load(): Promise<EmailReminderPreferenceViewModel>;
}

export type EmailReminderPreferenceActor = {
  context: unknown;
  userId: string;
};

export interface EmailReminderPreferenceCommands {
  loadActor(): Promise<EmailReminderPreferenceActor>;
  assertRateLimit(actor: EmailReminderPreferenceActor): Promise<void>;
  update(
    actor: EmailReminderPreferenceActor,
    enabled: boolean,
  ): Promise<EmailReminderPreferenceViewModel>;
}

export class EmailReminderPreferenceGatewayError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
