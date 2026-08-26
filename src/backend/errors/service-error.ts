import {
  SERVICE_ERROR_PUBLIC_MESSAGES,
  type PublicServiceErrorCode,
} from "@/shared/domain/service-error-catalog";

export type ServiceErrorCode = PublicServiceErrorCode;

export type ServiceErrorDebug = {
  message?: string;
  upstreamStatus?: number;
  upstreamPath?: string;
  upstreamCode?: string;
  upstreamDetail?: unknown;
  retryAfterSeconds?: number;
  cause?: unknown;
};

const PROD_MESSAGES: Record<ServiceErrorCode, string> = SERVICE_ERROR_PUBLIC_MESSAGES;

export function isServiceErrorCode(value: unknown): value is ServiceErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROD_MESSAGES, value);
}

export class ServiceError extends Error {
  public readonly prodMessage: string;

  constructor(
    public readonly code: ServiceErrorCode,
    public readonly status: number,
    message?: string,
    public readonly debug?: ServiceErrorDebug,
  ) {
    super(message ?? PROD_MESSAGES[code]);
    this.prodMessage = PROD_MESSAGES[code];
  }
}
