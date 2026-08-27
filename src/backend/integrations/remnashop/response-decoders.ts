function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  return value;
}

function nonemptyStringField(input: Record<string, unknown>, field: string) {
  const value = stringField(input, field);
  if (!value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function numberField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return value;
}

function booleanField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (typeof value !== "boolean") throw new TypeError(`${field} must be a boolean`);
  return value;
}

function nullableStringField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (value !== null && typeof value !== "string") {
    throw new TypeError(`${field} must be a string or null`);
  }
  return value as string | null;
}

function nullableNumberField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new TypeError(`${field} must be a finite number or null`);
  }
  return value as number | null;
}

function optionalBooleanField(input: Record<string, unknown>, field: string) {
  return input[field] === undefined ? undefined : booleanField(input, field);
}

function optionalNullableStringField(input: Record<string, unknown>, field: string) {
  return input[field] === undefined ? undefined : nullableStringField(input, field);
}

function arrayField(input: Record<string, unknown>, field: string) {
  const value = input[field];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}

function simpleBooleanResponse(value: unknown, field: string) {
  const input = record(value, "Remnashop response");
  return { [field]: booleanField(input, field) };
}

function decodeAuthResponse(value: unknown) {
  const input = record(value, "Remnashop auth response");
  return {
    expires_at: stringField(input, "expires_at"),
    refresh_expires_at: stringField(input, "refresh_expires_at"),
  };
}

function decodeProfile(value: unknown) {
  const input = record(value, "Remnashop profile");
  const hasPassword = optionalBooleanField(input, "has_password");
  return {
    telegram_id: nullableNumberField(input, "telegram_id"),
    auth_type: stringField(input, "auth_type"),
    email: nullableStringField(input, "email"),
    is_email_verified: booleanField(input, "is_email_verified"),
    pending_email: nullableStringField(input, "pending_email"),
    name: stringField(input, "name"),
    username: nullableStringField(input, "username"),
    language: stringField(input, "language"),
    ...(hasPassword === undefined ? {} : { has_password: hasPassword }),
  };
}

function decodeNotificationPreferences(value: unknown) {
  const input = record(value, "Remnashop notification preferences");
  return {
    subscription_expiration_email_enabled: booleanField(
      input,
      "subscription_expiration_email_enabled",
    ),
    email_eligible: booleanField(input, "email_eligible"),
    sender_email: nullableStringField(input, "sender_email"),
    days_before: arrayField(input, "days_before").map((item) => {
      if (typeof item !== "number" || !Number.isFinite(item)) {
        throw new TypeError("days_before must contain finite numbers");
      }
      return item;
    }),
  };
}

function decodeCurrentSubscription(value: unknown) {
  if (value === null) return null;
  const input = record(value, "Remnashop current subscription");
  return {
    user_remna_id: stringField(input, "user_remna_id"),
    status: stringField(input, "status"),
    is_trial: booleanField(input, "is_trial"),
    traffic_limit: numberField(input, "traffic_limit"),
    device_limit: numberField(input, "device_limit"),
    traffic_limit_strategy: stringField(input, "traffic_limit_strategy"),
    expire_at: stringField(input, "expire_at"),
    url: stringField(input, "url"),
    plan_name: stringField(input, "plan_name"),
    plan_duration_days: numberField(input, "plan_duration_days"),
    used_traffic_bytes: nullableNumberField(input, "used_traffic_bytes"),
    lifetime_used_traffic_bytes: nullableNumberField(
      input,
      "lifetime_used_traffic_bytes",
    ),
    online_at: nullableStringField(input, "online_at"),
  };
}

export function decodeRemnashopSubscriptionIdentity(value: unknown) {
  if (value === null) return null;
  const input = record(value, "Remnashop subscription identity");
  return {
    user_remna_id: nonemptyStringField(input, "user_remna_id"),
  };
}

function decodeGateway(value: unknown) {
  const input = record(value, "Remnashop gateway");
  return {
    gateway_type: stringField(input, "gateway_type"),
    currency: stringField(input, "currency"),
    currency_symbol: stringField(input, "currency_symbol"),
  };
}

function decodePrice(value: unknown) {
  const input = record(value, "Remnashop duration price");
  return {
    ...decodeGateway(input),
    original_amount: stringField(input, "original_amount"),
    discount_percent: numberField(input, "discount_percent"),
    final_amount: stringField(input, "final_amount"),
    is_free: booleanField(input, "is_free"),
  };
}

function decodeDuration(value: unknown) {
  const input = record(value, "Remnashop duration offer");
  return {
    days: numberField(input, "days"),
    prices: arrayField(input, "prices").map(decodePrice),
  };
}

function decodePlan(value: unknown) {
  const input = record(value, "Remnashop plan offer");
  const renewalTermsChanged = optionalBooleanField(input, "renewal_terms_changed");
  return {
    id: numberField(input, "id"),
    public_code: stringField(input, "public_code"),
    name: stringField(input, "name"),
    description: nullableStringField(input, "description"),
    traffic_limit: numberField(input, "traffic_limit"),
    device_limit: numberField(input, "device_limit"),
    type: stringField(input, "type"),
    recommended_purchase_type: stringField(input, "recommended_purchase_type"),
    ...(renewalTermsChanged === undefined
      ? {}
      : { renewal_terms_changed: renewalTermsChanged }),
    durations: arrayField(input, "durations").map(decodeDuration),
  };
}

function decodeOffers(value: unknown) {
  const input = record(value, "Remnashop subscription offers");
  return {
    gateways: arrayField(input, "gateways").map(decodeGateway),
    plans: arrayField(input, "plans").map(decodePlan),
    has_current_subscription: booleanField(input, "has_current_subscription"),
    current_subscription_status: nullableStringField(
      input,
      "current_subscription_status",
    ),
  };
}

function decodeDevice(value: unknown) {
  const input = record(value, "Remnashop subscription device");
  return {
    hwid: stringField(input, "hwid"),
    platform: nullableStringField(input, "platform"),
    device_model: nullableStringField(input, "device_model"),
    os_version: nullableStringField(input, "os_version"),
    user_agent: nullableStringField(input, "user_agent"),
  };
}

function decodeDevices(value: unknown) {
  const input = record(value, "Remnashop devices response");
  return {
    devices: arrayField(input, "devices").map(decodeDevice),
    current_count: numberField(input, "current_count"),
    max_count: numberField(input, "max_count"),
  };
}

function decodePaymentInit(value: unknown) {
  const input = record(value, "Remnashop payment response");
  const returnUrl = optionalNullableStringField(input, "return_url");
  return {
    payment_id: stringField(input, "payment_id"),
    payment_url: nullableStringField(input, "payment_url"),
    purchase_type: stringField(input, "purchase_type"),
    status: stringField(input, "status"),
    is_free: booleanField(input, "is_free"),
    final_amount: stringField(input, "final_amount"),
    currency: stringField(input, "currency"),
    ...(returnUrl === undefined ? {} : { return_url: returnUrl }),
  };
}

function decodeReferralProgram(value: unknown) {
  const input = record(value, "Remnashop referral program");
  return {
    enabled: booleanField(input, "enabled"),
    referral_code: stringField(input, "referral_code"),
    web_referral_url: stringField(input, "web_referral_url"),
    invited_count: numberField(input, "invited_count"),
    invited_with_payment_count: numberField(input, "invited_with_payment_count"),
    points_balance: numberField(input, "points_balance"),
    total_points_issued: numberField(input, "total_points_issued"),
    total_days_issued: numberField(input, "total_days_issued"),
    reward_type: stringField(input, "reward_type"),
    reward_strategy: stringField(input, "reward_strategy"),
    accrual_strategy: stringField(input, "accrual_strategy"),
    max_level: numberField(input, "max_level"),
    reward_levels: arrayField(input, "reward_levels").map((level) => {
      const item = record(level, "Remnashop referral reward level");
      return {
        level: numberField(item, "level"),
        value: numberField(item, "value"),
      };
    }),
  };
}

function decodeMergeResponse(value: unknown) {
  const input = record(value, "Remnashop merge response");
  const target = record(input.target, "Remnashop merge target");
  const moved = record(input.moved, "Remnashop moved counters");
  const projectedMoved = Object.fromEntries(
    Object.entries(moved).map(([key, count]) => {
      if (typeof count !== "number" || !Number.isFinite(count)) {
        throw new TypeError("Remnashop moved counters must be finite numbers");
      }
      return [key, count];
    }),
  );
  const conflicts = arrayField(input, "conflicts").map((item) => {
    if (typeof item !== "string") throw new TypeError("conflicts must contain strings");
    return item;
  });
  return {
    dry_run: booleanField(input, "dry_run"),
    source_user_id: numberField(input, "source_user_id"),
    target_user_id: numberField(input, "target_user_id"),
    target: {
      id: numberField(target, "id"),
      email: nullableStringField(target, "email"),
      telegram_id: nullableNumberField(target, "telegram_id"),
      is_email_verified: booleanField(target, "is_email_verified"),
      current_subscription_id: nullableNumberField(target, "current_subscription_id"),
    },
    moved: projectedMoved,
    conflicts,
    requires_relogin: booleanField(input, "requires_relogin"),
  };
}

export function decodeRemnashopEndpointResponse(
  path: string,
  method: string,
  value: unknown,
): unknown {
  const normalizedPath = path.split("?", 1)[0] ?? path;

  if (
    [
      "/auth/register",
      "/auth/login",
      "/auth/telegram",
      "/auth/telegram/webapp",
      "/auth/password/confirm-reset",
      "/auth/service-session",
      "/auth/refresh",
    ].includes(normalizedPath)
  ) return decodeAuthResponse(value);

  if (normalizedPath === "/auth/identify") return simpleBooleanResponse(value, "exists");
  if (normalizedPath === "/auth/password/request-reset") return simpleBooleanResponse(value, "success");
  if (normalizedPath === "/auth/change-password") return simpleBooleanResponse(value, "success");
  if (normalizedPath === "/auth/me" || normalizedPath === "/auth/telegram/link") {
    return decodeProfile(value);
  }
  if (normalizedPath === "/auth/notification-preferences") {
    return decodeNotificationPreferences(value);
  }
  if (normalizedPath === "/auth/email/request-verification") {
    const input = record(value, "Remnashop verification request response");
    return {
      success: booleanField(input, "success"),
      target_email: stringField(input, "target_email"),
      expires_at: stringField(input, "expires_at"),
    };
  }
  if (normalizedPath === "/auth/email/confirm") {
    const input = record(value, "Remnashop verification confirmation");
    const alreadyVerified = optionalBooleanField(input, "already_verified");
    const accountSyncPending = optionalBooleanField(input, "account_sync_pending");
    return {
      success: booleanField(input, "success"),
      email: stringField(input, "email"),
      ...(alreadyVerified === undefined ? {} : { already_verified: alreadyVerified }),
      ...(accountSyncPending === undefined ? {} : { account_sync_pending: accountSyncPending }),
    };
  }
  if (normalizedPath === "/auth/email/change") {
    const input = record(value, "Remnashop email change response");
    return {
      success: booleanField(input, "success"),
      pending_email: stringField(input, "pending_email"),
    };
  }
  if (normalizedPath === "/subscription/current") return decodeCurrentSubscription(value);
  if (normalizedPath === "/subscription/offers") return decodeOffers(value);
  if (normalizedPath === "/subscription/devices" && method === "DELETE") {
    return simpleBooleanResponse(value, "success");
  }
  if (normalizedPath === "/subscription/devices") return decodeDevices(value);
  if (/^\/subscription\/devices\/[^/]+$/.test(normalizedPath)) {
    return simpleBooleanResponse(value, "deleted");
  }
  if (normalizedPath === "/subscription/reissue") return simpleBooleanResponse(value, "success");
  if (normalizedPath === "/subscription/promocode") {
    const input = record(value, "Remnashop promocode response");
    return {
      success: booleanField(input, "success"),
      reward_type: stringField(input, "reward_type"),
    };
  }
  if (normalizedPath === "/subscription/purchase" || normalizedPath === "/subscription/extend") {
    return decodePaymentInit(value);
  }
  if (normalizedPath === "/referral/program") return decodeReferralProgram(value);
  if (normalizedPath === "/users/merge") return decodeMergeResponse(value);

  return value;
}
