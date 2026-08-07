export interface AuditLogInput {
  action: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditLogger {
  log(input: AuditLogInput): Promise<void>;
}
