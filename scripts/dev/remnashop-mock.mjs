import http from "node:http";

const port = Number(process.env.PORT || 8080);
const basePath = "/api/v1/public";

const user = {
  telegram_id: 99887766,
  auth_type: "email",
  email: "demo@clean-vpn.local",
  is_email_verified: true,
  pending_email: null,
  name: "Demo CleanVPN",
  username: "cleanvpn_demo",
  language: "ru",
};

const offers = {
  gateways: [
    { gateway_type: "card", currency: "RUB", currency_symbol: "RUB" },
    { gateway_type: "crypto", currency: "USDT", currency_symbol: "USDT" },
  ],
  has_current_subscription: true,
  current_subscription_status: "active",
  plans: [
    {
      id: 1,
      public_code: "cleanvpn-basic",
      name: "CleanVPN Basic",
      description: "Dev mock personal subscription.",
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
              currency_symbol: "RUB",
              original_amount: "299",
              discount_percent: 0,
              final_amount: "299",
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
      description: "Dev mock family subscription.",
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
              currency_symbol: "RUB",
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

const subscription = {
  user_remna_id: "dev-remna-user-001",
  status: "active",
  is_trial: false,
  traffic_limit: 0,
  device_limit: 8,
  traffic_limit_strategy: "no_limit",
  expire_at: new Date(Date.now() + 1000 * 60 * 60 * 24 * 27).toISOString(),
  url: "https://dev.clean-vpn.local/sub/mock-token",
  plan_name: "CleanVPN Family",
  plan_duration_days: 30,
  used_traffic_bytes: 128 * 1024 * 1024 * 1024,
  lifetime_used_traffic_bytes: 940 * 1024 * 1024 * 1024,
  online_at: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
};

const devices = {
  current_count: 2,
  max_count: 8,
  devices: [
    { hwid: "dev-ios-iphone", platform: "iOS", device_model: "iPhone", os_version: "17", user_agent: "CleanVPN iOS" },
    { hwid: "dev-macos-macbook", platform: "macOS", device_model: "MacBook", os_version: "14", user_agent: "CleanVPN macOS" },
  ],
};

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

function createJwt(sub, ttlSeconds) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub, exp: Math.floor(Date.now() / 1000) + ttlSeconds })}.dev-signature`;
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function authResponse(response, status = 200) {
  const accessToken = createJwt("dev-remna-user-001", 15 * 60);
  const refreshToken = createJwt("dev-remna-user-001", 30 * 24 * 60 * 60);
  json(response, status, {
    expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }, {
    "set-cookie": [
      `access_token=${accessToken}; Path=/; HttpOnly; SameSite=Lax`,
      `refresh_token=${refreshToken}; Path=/; HttpOnly; SameSite=Lax`,
    ],
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) || "/" : url.pathname;

  try {
    if (path === "/health") return json(response, 200, { status: "ok" });
    if (request.method === "GET" && path === "/plans/public") return json(response, 200, offers.plans);
    if (request.method === "POST" && (path === "/auth/login" || path === "/auth/register")) return authResponse(response, path.endsWith("register") ? 201 : 200);
    if (request.method === "POST" && path === "/auth/refresh") return authResponse(response);
    if (request.method === "POST" && path === "/auth/logout") return json(response, 200, { success: true });
    if (request.method === "GET" && path === "/auth/me") return json(response, 200, user);
    if (request.method === "POST" && path === "/auth/change-password") return authResponse(response);
    if (request.method === "POST" && path === "/auth/email/change") {
      const body = await readBody(request);
      return json(response, 200, { success: true, pending_email: body.email ?? "new-demo@clean-vpn.local" });
    }
    if (request.method === "POST" && path === "/auth/email/request-verification") {
      const body = await readBody(request);
      return json(response, 200, { success: true, target_email: body.email ?? user.email, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() });
    }
    if (request.method === "POST" && path === "/auth/email/confirm") return json(response, 200, { success: true, email: user.email });
    if (request.method === "GET" && path === "/subscription/current") return json(response, 200, subscription);
    if (request.method === "GET" && path === "/subscription/offers") return json(response, 200, offers);
    if (request.method === "POST" && (path === "/subscription/purchase" || path === "/subscription/extend")) {
      const body = await readBody(request);
      return json(response, 200, { payment_id: `dev-pay-${Date.now()}`, payment_url: null, purchase_type: path.endsWith("extend") ? "renew" : "new", status: "completed", is_free: true, final_amount: "0", currency: body.gateway_type === "crypto" ? "USDT" : "RUB" });
    }
    if (request.method === "GET" && path === "/subscription/devices") return json(response, 200, devices);
    if (request.method === "DELETE" && path === "/subscription/devices") return json(response, 200, { success: true });
    if (request.method === "DELETE" && path.startsWith("/subscription/devices/")) return json(response, 200, { deleted: true });
    if (request.method === "POST" && path === "/subscription/reissue") return json(response, 200, { success: true });
    if (request.method === "POST" && path === "/subscription/promocode") return json(response, 200, { success: true, reward_type: "extra_days" });

    return json(response, 404, { detail: "Not found", path });
  } catch (error) {
    return json(response, 500, { detail: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Remnashop mock listening on ${port}`);
});
