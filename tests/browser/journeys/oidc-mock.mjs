import crypto from "node:crypto";
import http from "node:http";

const issuer = process.env.OIDC_ISSUER ?? "https://oauth.telegram.org";
const publicIssuer = process.env.OIDC_PUBLIC_ISSUER ?? issuer;
const port = Number(process.env.PORT ?? "8090");
const keyId = "clean-pay-browser-journey-oidc-key";
const seed = "clean-pay-browser-journey-v1";
const clientId = "7654321098";
const clientSecret = crypto.createHash("sha256")
  .update("clean-pay-browser-journey:telegram-oidc", "utf8")
  .digest("hex");
const ledgerUrl = process.env.OIDC_LEDGER_URL ?? null;
const ledgerKey = crypto.createHash("sha256")
  .update("clean-pay-browser-journey:oidc-ledger", "utf8")
  .digest("hex");
const codes = new Map();
let authorizeSequence = 0;
let eventCount = 0;
let activeScenario = "contract-default";
let activeSubject = "900000001";
const privateKey = crypto.createPrivateKey({
  format: "jwk",
  key: {
    kty: "RSA",
    n: "0pFiQejVXnYEgBf2A0GD1FU51GOPVU9Zn6v40652cydMfTi0DmXzhC5Nz6hcEn6FKqTtlXaNXQCHFWqa0BF0GWRNFWEUx6tTHX9-y-l1gKkFJKclpnx6VG2Tyg4PqLUNNI84Osj8xV1H2pU3892hGyOct_7Z-rjH2AHBSC4t_TwU5XNRDWwMFDuwj7eU9225XpYPAvQgWPwVpBlT0v2l6X2Za5dt8z-xmevL_9XjPhzuetDsVoEkT_kcFY-Q3_ElFi0swjE-Qx0ow6R51YtPCoysz-aOvOXHqm4pSl4aoYx7vGx7jdqAgFJgQH9Uwu0ZpU0L7EiOWQ04V-z7YKk0Ew",
    e: "AQAB",
    d: "QroPiRNfii-b_XuaWi3IuODJEqT6Ju6eWBsHHw2KO7OYaZYueOGV6a1Cuyt_Ad1WFc1t_I80_OPN6tt9c7IUOHewdbXt_9gq3o4ogDXbJoppNtRA-iE4IskWrFEIZU36gU1hZD-M2n5U5s-ii4UQKKmAYE5ChVFJAwqLVXRM3pI3_NtLWEGReWhUfvvvLat-JOE9pQllmlMSG17xLTgBjflen6l3Ch2FwP-oTfwGxXbdn41qZVDDPdhilDtTxeFjDvkZni7i2GDeh89HnaqmzBQACrfM9tP0gShbaHpK4N1yLej1ML9VDnN-0PTodFKOV_EYB8FJpamc3-WV1Yc_AQ",
    p: "-jsTNGiQKl1YuA7yiNCJc39exyD9cPirD6qJrPIMOR2X_05fcCfJoSBVQtU3fFFmFnNVVjTd6MfP2VIldPlZBQw5VNpElewQk2xv5WqZeytpUUB_6lEwKS5UhlrCRgPN4C7ZZ2fuyUkJDrb_IPqqaM3oyIe4VRdG8q-T5PgzCmc",
    q: "12w1aO1HcopjyRQXtUD9xEoeyyh74QgMoTYYxFAQzJMogPR9h5ypisYLktwRuI7dEVfQqml83XjU17YHZaYJng_qqkHBQUxaZxUpWE0ir01BL8qrYS7zzY8SlCI5xIDYzR03IggVdMcoBVpRV_VKJwxBWsDyn1WneTa3GAvNFXU",
    dp: "G3bKZ9EmKZAvQZxaYEvLGkMbiu2DA5g3ZjPIgpPaZZZq7VmTvgKP7cBXu0sdmOZyNvqXniuVQ4xSsr6CX_FSJOyvijGen3nWY-fd7CckC1G7cHCM2ZHpoEt2eXySoA6g1P8vW1sb6Tm75cKOA_efJnubFg9XWveAEPjWWaYoK_c",
    dq: "PRYaLx7Z28kScrqX3nYHf9nk0YcxWaaGrlBAxapOmTRBkA_EaOgry4ZNUd_Fxqf8WCamrSwslEDnWiPsBQ8IOyIYUR9ERdf46rI9fySgaUVm7r5xyqUdzXR8uDTcXLSMxd06_RN9wheXaa0q095ioKABCFMeecA4NU8mrFLsXOE",
    qi: "hmZO9m_TiZqYhKjRhZggtDzmsRzKxmLnAoUfIhThexUrjJgLWeTe1uIY45f0k_6DHCy3F1zMYLJL2pUkqvspyFuM3gvPK7Qu0HTeyoiQi2XlIal-KsG3sVOjkMkp3P9qKMbgLoYDjaN81I6u969imv-wahoCzNeKojLl0Ocen14",
  },
});
const publicKey = crypto.createPublicKey(privateKey);
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: keyId,
  alg: "RS256",
  use: "sig",
};

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signJwt(payload) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }));
  const body = base64url(JSON.stringify(payload));
  const signed = `${header}.${body}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(signed), privateKey);
  return `${signed}.${base64url(signature)}`;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function collectBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) request.destroy(new Error("request too large"));
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function authorize(response, url) {
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const requestedClientId = url.searchParams.get("client_id") ?? "";
  const responseType = url.searchParams.get("response_type") ?? "";
  const scope = url.searchParams.get("scope") ?? "";
  const codeChallenge = url.searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = url.searchParams.get("code_challenge_method") ?? "";
  const requestedSubject = url.searchParams.get("test_user") ?? activeSubject;
  const subject = /^9\d{8,18}$/.test(requestedSubject)
    ? requestedSubject
    : "900000001";
  const validRedirect = redirectUri === "https://pay.ci.clean-pay.dev/auth/telegram/callback";
  if (
    !validRedirect
    || requestedClientId !== clientId
    || responseType !== "code"
    || scope !== "openid profile"
    || codeChallengeMethod !== "S256"
    || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)
    || !state
    || !nonce
  ) {
    await recordOidcEvent({
      method: "GET",
      pathname: "/auth",
      query: url.searchParams,
      effect: "authorize_rejected",
    });
    sendJson(response, 400, { error: "invalid_request" });
    return;
  }
  authorizeSequence += 1;
  const code = crypto.createHash("sha256")
    .update(`${seed}:${authorizeSequence}:${subject}`, "utf8")
    .digest("hex")
    .slice(0, 48);
  codes.set(code, {
    clientId: requestedClientId,
    nonce,
    codeChallenge,
    redirectUri,
    subject,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  await recordOidcEvent({
    method: "GET",
    pathname: "/auth",
    query: url.searchParams,
    effect: "authorization_code_issued",
  });
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", state);
  response.writeHead(302, { "cache-control": "no-store", location: redirect.toString() });
  response.end();
}

async function exchange(request, response) {
  const body = await collectBody(request);
  const params = new URLSearchParams(body);
  const code = params.get("code") ?? "";
  const entry = codes.get(code);
  const authorization = request.headers.authorization ?? "";
  const expectedAuthorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  const verifier = params.get("code_verifier") ?? "";
  const verifierChallenge = crypto.createHash("sha256")
    .update(verifier, "utf8")
    .digest("base64url");
  const valid = entry
    && entry.expiresAt >= Date.now()
    && authorization === expectedAuthorization
    && params.get("grant_type") === "authorization_code"
    && params.get("client_id") === clientId
    && params.get("redirect_uri") === entry.redirectUri
    && verifierChallenge === entry.codeChallenge;
  if (!valid) {
    await recordOidcEvent({
      method: "POST",
      pathname: "/token",
      body,
      authorization,
      effect: "token_exchange_rejected",
    });
    sendJson(response, 400, { error: "invalid_grant" });
    return;
  }
  codes.delete(code);
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: issuer,
    aud: entry.clientId,
    sub: entry.subject,
    id: entry.subject,
    telegram_id: entry.subject,
    username: `browser_user_${entry.subject}`,
    preferred_username: `browser_user_${entry.subject}`,
    name: "Synthetic Browser User",
    given_name: "Synthetic",
    family_name: "User",
    picture: `${publicIssuer}/avatar.png`,
    nonce: entry.nonce,
    iat: now,
    exp: now + 300,
  };
  await recordOidcEvent({
    method: "POST",
    pathname: "/token",
    body,
    authorization,
    effect: "token_exchanged",
  });
  sendJson(response, 200, {
    token_type: "Bearer",
    access_token: "synthetic-browser-access-token",
    expires_in: 300,
    id_token: signJwt(payload),
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", publicIssuer);
    if (request.method === "GET" && url.pathname === "/auth") {
      await authorize(response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/token") {
      await exchange(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      await recordOidcEvent({
        method: "GET",
        pathname: "/.well-known/jwks.json",
        effect: "jwks_read",
      });
      sendJson(response, 200, { keys: [jwk] });
      return;
    }
    if (request.method === "POST" && url.pathname === "/__reset") {
      const body = await collectBody(request);
      const input = body ? JSON.parse(body) : {};
      const scenario = input.scenario ?? "contract-default";
      if (typeof scenario !== "string" || !/^[a-z0-9][a-z0-9:-]{1,180}$/.test(scenario)) {
        sendJson(response, 422, { error: "invalid_scenario" });
        return;
      }
      activeScenario = scenario;
      activeSubject = String(scenarioTelegramId(scenario));
      codes.clear();
      authorizeSequence = 0;
      eventCount = 0;
      sendJson(response, 200, {
        status: "reset",
        codes: codes.size,
        authorize_sequence: authorizeSequence,
        event_count: eventCount,
        key_id: keyId,
        seed_sha256: crypto.createHash("sha256").update(seed, "utf8").digest("hex"),
        scenario_sha256: sha256(activeScenario),
        subject_format: "9-digit-synthetic",
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/avatar.png") {
      response.writeHead(204, { "cache-control": "public, max-age=3600" });
      response.end();
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  } catch {
    sendJson(response, 500, { error: "internal_error" });
  }
});

async function recordOidcEvent({
  method,
  pathname,
  query = new URLSearchParams(),
  body = "",
  authorization = "",
  effect,
}) {
  if (!ledgerUrl) return;
  const bodyContract = pathname === "/auth"
    ? {
        encoding: "query",
        fields: [...query.entries()].map(([name, value]) => ({
          name,
          value: oidcContractValue(name, value),
        })).sort((left, right) => left.name.localeCompare(right.name)),
      }
    : body
      ? {
          encoding: "urlencoded",
          fields: [...new URLSearchParams(body).entries()].map(([name, value]) => ({
            name,
            value: oidcContractValue(name, value),
          })).sort((left, right) => left.name.localeCompare(right.name)),
        }
      : null;
  const event = {
    service: "telegram-oidc",
    method,
    pathname,
    query_keys: [...new Set(query.keys())].sort(),
    body_bytes: Buffer.byteLength(body, "utf8"),
    body_sha256: sha256(body),
    body_contract: bodyContract,
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
    credential_contract: {
      header_names: authorization ? ["authorization"] : [],
      authorization_scheme: authorization ? authorization.split(/\s+/, 1)[0] : null,
      cookie_names: [],
    },
    effect,
  };
  const ledgerResponse = await fetch(ledgerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-browser-fixture-key": ledgerKey,
    },
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(2_000),
  });
  if (!ledgerResponse.ok) throw new Error("OIDC ledger rejected a synthetic event");
  eventCount += 1;
}

function oidcContractValue(name, value) {
  const bytes = Buffer.byteLength(value, "utf8");
  const digest = sha256(value);
  if (["code", "code_verifier", "state", "nonce", "code_challenge"].includes(name)) {
    return { kind: "dynamic", format: `oidc-${name.replaceAll("_", "-")}`, bytes, sha256: digest };
  }
  if (name === "client_id") {
    return { kind: "redacted", format: "oidc-client-id", bytes, sha256: digest };
  }
  if (name === "redirect_uri") {
    return { kind: "url", origin: "https://pay.ci.clean-pay.dev", path: ["", "auth", "telegram", "callback"], query: [], fragment: null };
  }
  return value;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function scenarioTelegramId(scenario) {
  if (scenario === "contract-default") return 900000001;
  return 900000000 + (Number.parseInt(sha256(`telegram:${scenario}`).slice(0, 8), 16) % 99999999);
}

server.listen(port, "0.0.0.0");
