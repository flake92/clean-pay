type AuditSeverity = "INFO" | "WARN" | "ERROR";
export interface AuditEvent {
  action: string;
  userId: string | null;
  severity: AuditSeverity;
  ipHash: string | null;
  metadata?: Record<string, unknown>;
}
export interface AuditEventRepository { append(event: AuditEvent): Promise<void>; }
