export type RemnawaveUser = {
  uuid?: string;
  status?: string;
  email?: string | null;
  telegramId?: number | string | null;
  expireAt?: string | null;
  subscriptionUrl?: string | null;
  subscription_url?: string | null;
};

export type RemnawaveSingleResponse = {
  response?: RemnawaveUser | null;
};

export type RemnawaveListResponse = {
  response?: RemnawaveUser[] | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = input[field];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TypeError(`Remnawave ${field} must be a string`);
  }
  return value;
}

function optionalNullableString(
  input: Record<string, unknown>,
  field: string,
): string | null | undefined {
  const value = input[field];
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== "string") {
    throw new TypeError(`Remnawave ${field} must be a string`);
  }
  return value;
}

export function decodeRemnawaveUser(value: unknown): RemnawaveUser {
  if (!isRecord(value)) {
    throw new TypeError("Remnawave user must be an object");
  }

  const telegramId = value.telegramId;
  if (
    telegramId !== undefined
    && telegramId !== null
    && typeof telegramId !== "string"
    && typeof telegramId !== "number"
  ) {
    throw new TypeError("Remnawave telegramId must be a string or number");
  }

  return {
    ...(value.uuid === undefined ? {} : { uuid: optionalString(value, "uuid") }),
    ...(value.status === undefined ? {} : { status: optionalString(value, "status") }),
    ...(value.email === undefined ? {} : { email: optionalNullableString(value, "email") }),
    ...(telegramId === undefined ? {} : { telegramId: telegramId as string | number | null }),
    ...(value.expireAt === undefined ? {} : { expireAt: optionalNullableString(value, "expireAt") }),
    ...(value.subscriptionUrl === undefined
      ? {}
      : { subscriptionUrl: optionalNullableString(value, "subscriptionUrl") }),
    ...(value.subscription_url === undefined
      ? {}
      : { subscription_url: optionalNullableString(value, "subscription_url") }),
  };
}

function responseEnvelope(value: unknown) {
  if (!isRecord(value) || !("response" in value)) {
    throw new TypeError("Remnawave response envelope is invalid");
  }

  return value.response;
}

export function decodeRemnawaveSingleResponse(
  value: unknown,
): RemnawaveSingleResponse {
  const response = responseEnvelope(value);

  return {
    response: response === null ? null : decodeRemnawaveUser(response),
  };
}

export function decodeRemnawaveListResponse(
  value: unknown,
): RemnawaveListResponse {
  const response = responseEnvelope(value);
  if (response !== null && !Array.isArray(response)) {
    throw new TypeError("Remnawave response must contain a user array");
  }

  return {
    response: response === null ? null : response.map(decodeRemnawaveUser),
  };
}
