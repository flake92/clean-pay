import type {
  ChangeEmailResponse,
  ChangePasswordResponse,
  ConfirmEmailVerificationResponse,
  CurrentSubscriptionResponse,
  DeviceDeleteResponse,
  DevicesDeleteAllResponse,
  DevicesResponse,
  PaymentInitResponse,
  PromocodeActivateResponse,
  ReissueResponse,
  RemnashopMe,
  RequestEmailVerificationResponse,
  SubscriptionOffersResponse,
} from "@/lib/remnashop/types";

export function isMockMode() {
  return process.env.CLEAN_PAY_MOCK_MODE === "1";
}

export const mockUser: RemnashopMe = {
  telegram_id: 99887766,
  auth_type: "email",
  email: "demo@clean-vpn.local",
  is_email_verified: true,
  pending_email: null,
  name: "Demo CleanVPN",
  username: "cleanvpn_demo",
  language: "ru",
};

export const mockOffers: SubscriptionOffersResponse = {
  gateways: [
    { gateway_type: "card", currency: "RUB", currency_symbol: "₽" },
    { gateway_type: "crypto", currency: "USDT", currency_symbol: "USDT" },
  ],
  has_current_subscription: true,
  current_subscription_status: "active",
  plans: [
    {
      id: 1,
      public_code: "cleanvpn-basic",
      name: "CleanVPN Basic",
      description: "Персональная подписка для телефона и ноутбука.",
      traffic_limit: 0,
      device_limit: 3,
      type: "personal",
      recommended_purchase_type: "new",
      durations: [
        {
          days: 30,
          prices: [
            {
              gateway_type: "card",
              currency: "RUB",
              currency_symbol: "₽",
              original_amount: "299",
              discount_percent: 0,
              final_amount: "299",
              is_free: false,
            },
          ],
        },
        {
          days: 90,
          prices: [
            {
              gateway_type: "card",
              currency: "RUB",
              currency_symbol: "₽",
              original_amount: "897",
              discount_percent: 10,
              final_amount: "807",
              is_free: false,
            },
          ],
        },
      ],
    },
    {
      id: 2,
      public_code: "cleanvpn-family",
      name: "CleanVPN Family",
      description: "Расширенный лимит устройств для семьи.",
      traffic_limit: 0,
      device_limit: 8,
      type: "family",
      recommended_purchase_type: "renew",
      durations: [
        {
          days: 30,
          prices: [
            {
              gateway_type: "card",
              currency: "RUB",
              currency_symbol: "₽",
              original_amount: "599",
              discount_percent: 0,
              final_amount: "599",
              is_free: false,
            },
            {
              gateway_type: "crypto",
              currency: "USDT",
              currency_symbol: "USDT",
              original_amount: "7",
              discount_percent: 0,
              final_amount: "7",
              is_free: false,
            },
          ],
        },
      ],
    },
  ],
};

export const mockSubscription: CurrentSubscriptionResponse = {
  user_remna_id: "mock-remna-user-001",
  status: "active",
  is_trial: false,
  traffic_limit: 0,
  device_limit: 8,
  traffic_limit_strategy: "no_limit",
  expire_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 27).toISOString(),
  url: "https://demo.clean-vpn.local/sub/mock-token",
  plan_name: "CleanVPN Family",
  plan_duration_days: 30,
  used_traffic_bytes: 128 * 1024 * 1024 * 1024,
  lifetime_used_traffic_bytes: 940 * 1024 * 1024 * 1024,
  online_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
};

export const mockDevices: DevicesResponse = {
  current_count: 3,
  max_count: 8,
  devices: [
    {
      hwid: "mock-ios-iphone",
      platform: "iOS",
      device_model: "iPhone 15",
      os_version: "17.6",
      user_agent: "CleanVPN iOS",
    },
    {
      hwid: "mock-macos-macbook",
      platform: "macOS",
      device_model: "MacBook Pro",
      os_version: "14.5",
      user_agent: "CleanVPN macOS",
    },
    {
      hwid: "mock-windows-desktop",
      platform: "Windows",
      device_model: "Desktop",
      os_version: "11",
      user_agent: "CleanVPN Windows",
    },
  ],
};

export const mockPayments = [
  {
    payment_id: "mock-pay-1003",
    purchase_type: "renew",
    status: "completed",
    final_amount: "599",
    currency: "RUB",
    gateway_type: "card",
    plan_name: "CleanVPN Family",
    duration_days: 30,
    is_free: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
  },
  {
    payment_id: "mock-pay-1002",
    purchase_type: "new",
    status: "completed",
    final_amount: "299",
    currency: "RUB",
    gateway_type: "card",
    plan_name: "CleanVPN Basic",
    duration_days: 30,
    is_free: false,
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 31).toISOString(),
  },
];

export const mockSupport = {
  enabled: true,
  email: "support@clean-vpn.local",
  telegramUsername: "cleanvpn_support",
  faqUrl: "https://clean-vpn.local/faq",
};

export function mockAuthPayload() {
  return {
    user: mockUser,
    expiresAt: new Date(Date.now() + 1000 * 60 * 15).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
  };
}

export function mockPayment(body?: { gateway_type?: string; duration_days?: number }): PaymentInitResponse {
  return {
    payment_id: `mock-pay-${Date.now()}`,
    payment_url: null,
    purchase_type: "mock",
    status: "completed",
    is_free: true,
    final_amount: "0",
    currency: body?.gateway_type === "crypto" ? "USDT" : "RUB",
  };
}

export const mockRequestVerification = (): RequestEmailVerificationResponse => ({
  success: true,
  target_email: mockUser.email ?? "demo@clean-vpn.local",
  expires_at: new Date(Date.now() + 1000 * 60 * 15).toISOString(),
});

export const mockConfirmEmail = (): ConfirmEmailVerificationResponse => ({
  success: true,
  email: mockUser.email ?? "demo@clean-vpn.local",
});

export const mockChangeEmail = (): ChangeEmailResponse => ({
  success: true,
  pending_email: "new-demo@clean-vpn.local",
});

export const mockChangePassword = (): ChangePasswordResponse => ({ success: true });
export const mockReissue = (): ReissueResponse => ({ success: true });
export const mockPromocode = (): PromocodeActivateResponse => ({
  success: true,
  reward_type: "extra_days",
});
export const mockDeleteDevice = (): DeviceDeleteResponse => ({ deleted: true });
export const mockDeleteDevices = (): DevicesDeleteAllResponse => ({ success: true });
