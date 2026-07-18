import { BffError } from "@/backend/integrations/remnashop/errors";
import { readBffJsonObject } from "@/backend/http/request-body";
import type { ExtendRequest, PurchaseRequest } from "@/shared/remnashop/types";

type JsonObject = Record<string, unknown>;

const amountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;
const currencyPattern = /^[A-Z0-9]{2,12}$/;

function validationError(message: string): never {
  throw new BffError("VALIDATION_ERROR", 400, message);
}

function stringField(
  body: JsonObject,
  field: string,
  { maxLength, pattern }: { maxLength: number; pattern?: RegExp },
) {
  const value = body[field];

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    (pattern && !pattern.test(value))
  ) {
    validationError(`${field} is invalid`);
  }

  return value as string;
}

function durationField(body: JsonObject) {
  const value = body.duration_days;

  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 365_000) {
    validationError("duration_days must be a non-negative integer");
  }

  return Number(value);
}

function confirmedFields(body: JsonObject) {
  return {
    confirmed_amount: stringField(body, "confirmed_amount", {
      maxLength: 64,
      pattern: amountPattern,
    }),
    confirmed_currency: stringField(body, "confirmed_currency", {
      maxLength: 12,
      pattern: currencyPattern,
    }),
    offer_version: stringField(body, "offer_version", { maxLength: 2_048 }),
  };
}

export async function readPurchaseRequest(request: Request): Promise<PurchaseRequest> {
  const body = await readBffJsonObject(request);

  return {
    plan_code: stringField(body, "plan_code", { maxLength: 200 }),
    duration_days: durationField(body),
    gateway_type: stringField(body, "gateway_type", { maxLength: 100 }),
    ...confirmedFields(body),
  };
}

export async function readExtendRequest(request: Request): Promise<ExtendRequest> {
  const body = await readBffJsonObject(request);

  return {
    duration_days: durationField(body),
    gateway_type: stringField(body, "gateway_type", { maxLength: 100 }),
    ...confirmedFields(body),
  };
}
