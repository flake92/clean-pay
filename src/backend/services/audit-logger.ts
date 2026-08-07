export interface AuditLogger {
  log(input: any): Promise<void>;
}
