export interface AuditLogInput {
  action: string;
  userId?: string;
  metadata?: Record<string, any>;
}

export interface AuditLogger {
  log(input: AuditLogInput): Promise<void>;
}
