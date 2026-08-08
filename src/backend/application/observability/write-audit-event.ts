import type { AuditEvent, AuditEventRepository } from "@/backend/application/observability/ports/audit-event-repository";
export function writeAuditEvent(repository: AuditEventRepository, event: AuditEvent) { return repository.append(event); }
