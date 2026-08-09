import type { LinkAccountPasskeyViewModel } from "@/application/models/link-account";

export type PasskeyManagementActor = {
  userId: string;
  fullAssurance: boolean;
  email: string | null;
  emailVerified: boolean;
  telegramId: string | null;
};

export interface PasskeyManagementGateway {
  loadActor(): Promise<PasskeyManagementActor | null>;
  loadOwned(userId: string): Promise<LinkAccountPasskeyViewModel[]>;
  deleteOwned(userId: string, credentialId: string): Promise<{ externalCredentialId: string }>;
  auditDeleted(userId: string, externalCredentialId: string): Promise<void>;
}
