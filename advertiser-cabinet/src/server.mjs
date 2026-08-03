import { createServer } from "node:http";
import { URLSearchParams } from "node:url";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./config.mjs";
import { createSession, csrfToken, readCookie, readSession, sessionCookie, verifyCsrf, verifyPassword } from "./auth.mjs";
import { dashboardPage, loginPage } from "./html.mjs";
import { createStatsStore, normalizeMonth } from "./stats.mjs";

const config = loadConfig();
const store = createStatsStore(config);
const attempts = new Map();

function securityHeaders(nonce = "") {
  return {
    "content-security-policy": `default-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; style-src 'nonce-${nonce}'; img-src 'self'; connect-src 'self'`,
    "referrer-policy": "no-referrer",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), publickey-credentials-get=()",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "cache-control": "no-store",
    "cross-origin-opener-policy": "same-origin",
  };
}

function reply(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  response.end(body);
}

function redirect(response, location, cookie = null) {
  response.writeHead(303, { location, "cache-control": "no-store", ...(cookie ? { "set-cookie": cookie } : {}) });
  response.end();
}

async function formBody(request) {
  if (!String(request.headers["content-type"] || "").startsWith("application/x-www-form-urlencoded")) {
    throw Object.assign(new Error("Unsupported content type"), { status: 415 });
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw Object.assign(new Error("Request is too large"), { status: 413 });
    chunks.push(chunk);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function accountSession(request) {
  const token = readCookie(request.headers.cookie, "cp_advertiser_session");
  return { token, account: readSession(token, config.accounts, config.sessionSecret) };
}

function allowedCampaigns(account) {
  return account.role === "admin"
    ? config.campaigns
    : config.campaigns.filter(({ id }) => account.campaignIds.includes(id));
}

function remoteIdentity(request) {
  return String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "unknown").split(",")[0].trim().slice(0, 80);
}

function loginAllowed(key, now = Date.now()) {
  const current = attempts.get(key);
  if (!current || now - current.startedAt > 15 * 60_000) return true;
  return current.count < 5;
}

function failedLogin(key, now = Date.now()) {
  const current = attempts.get(key);
  attempts.set(key, !current || now - current.startedAt > 15 * 60_000
    ? { count: 1, startedAt: now }
    : { ...current, count: current.count + 1 });
}

function sameOrigin(request) {
  const fetchSite = String(request.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  const origin = request.headers.origin;
  if (!origin) return true;
  const hosts = [request.headers.host, request.headers["x-forwarded-host"]]
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  try { return hosts.includes(new URL(origin).host.toLowerCase()); } catch { return false; }
}

const server = createServer(async (request, response) => {
  const requestId = randomUUID();
  response.setHeader("x-request-id", requestId);
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname === config.basePath) return redirect(response, `${config.basePath}/`);
    if (!url.pathname.startsWith(`${config.basePath}/`)) return reply(response, 404, "Not found", securityHeaders());
    const route = url.pathname.slice(config.basePath.length) || "/";

    if (route === "/health" && request.method === "GET") {
      await store.health();
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return response.end('{"status":"ok","readOnly":true}');
    }

    const session = accountSession(request);
    if (route === "/login" && request.method === "GET") {
      if (session.account) return redirect(response, `${config.basePath}/`);
      const page = loginPage({ basePath: config.basePath });
      return reply(response, 200, page.html, securityHeaders(page.nonce));
    }
    if (route === "/login" && request.method === "POST") {
      if (!sameOrigin(request)) return reply(response, 403, "Forbidden", securityHeaders());
      const body = await formBody(request);
      const login = String(body.get("login") || "").trim().toLowerCase().slice(0, 64);
      const password = String(body.get("password") || "").slice(0, 256);
      const key = `${remoteIdentity(request)}:${login}`;
      const account = config.accounts.find((item) => item.login === login);
      const allowed = loginAllowed(key);
      const valid = verifyPassword(password, account?.passwordHash || config.accounts[0].passwordHash);
      if (!allowed || !account || !valid) {
        failedLogin(key);
        const page = loginPage({ basePath: config.basePath, error: "Неверный логин или пароль." });
        return reply(response, allowed ? 401 : 429, page.html, securityHeaders(page.nonce));
      }
      attempts.delete(key);
      const token = createSession(account.login, config.sessionSecret);
      return redirect(response, `${config.basePath}/`, sessionCookie(token, config));
    }

    if (!session.account) return redirect(response, `${config.basePath}/login`, sessionCookie("", config, true));
    if (route === "/logout" && request.method === "POST") {
      if (!sameOrigin(request)) return reply(response, 403, "Forbidden", securityHeaders());
      const body = await formBody(request);
      if (!verifyCsrf(body.get("csrf"), session.token, config.sessionSecret)) return reply(response, 403, "Forbidden", securityHeaders());
      return redirect(response, `${config.basePath}/login`, sessionCookie("", config, true));
    }
    if (route !== "/" || request.method !== "GET") return reply(response, 404, "Not found", securityHeaders());

    const campaigns = allowedCampaigns(session.account);
    const requestedCampaign = url.searchParams.get("campaign");
    const campaign = campaigns.find(({ id }) => id === requestedCampaign) || campaigns[0];
    const month = normalizeMonth(url.searchParams.get("month"));
    const stats = await store.campaignStats(campaign, month);
    const page = dashboardPage({ config, account: session.account, campaigns, stats, csrf: csrfToken(session.token, config.sessionSecret) });
    return reply(response, 200, page.html, securityHeaders(page.nonce));
  } catch (error) {
    const status = Number(error?.status) || 503;
    console.error(JSON.stringify({ level: "error", event: "request_failed", requestId, status, message: error instanceof Error ? error.message : "Unknown error" }));
    return reply(response, status, status === 503 ? "Сервис статистики временно недоступен." : "Запрос отклонён.", securityHeaders());
  }
});

await store.health();
server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({ level: "info", event: "advertiser_cabinet_started", host: config.host, port: config.port, basePath: config.basePath, readOnly: true }));
});

async function shutdown(signal) {
  console.log(JSON.stringify({ level: "info", event: "shutdown", signal }));
  server.close();
  await store.close();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
