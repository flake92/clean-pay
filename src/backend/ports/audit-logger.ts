export type AuditLogInput = {
  action: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  severity?: "INFO" | "WARN" | "ERROR";
};

export interface AuditLogger {
  log(input: AuditLogInput): Promise<void>;
}
