const http = require("node:http");
const crypto = require("node:crypto");

const issuer = process.env.OIDC_ISSUER || "http://telegram-oidc-mock:8090";
const publicIssuer = process.env.OIDC_PUBLIC_ISSUER || "http://localhost:8090";
const clientId = process.env.OIDC_CLIENT_ID || "dev-telegram-client-id";
const port = Number(process.env.PORT || 8090);

const keyId = "clean-pay-dev-telegram-oidc-key";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const publicJwk = publicKey.export({ format: "jwk" });

const jwk = {
  ...publicJwk,
  kid: keyId,
  alg: "RS256",
  use: "sig",
};

const codes = new Map();

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
  });
  res.end(body);
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload) {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: keyId,
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.sign("RSA-SHA256", Buffer.from(data), privateKey);

  return `${data}.${base64url(signature)}`;
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      resolve(body);
    });

    req.on("error", reject);
  });
}

function auth(req, res, url) {
  const redirectUri = url.searchParams.get("redirect_uri");
  const state = url.searchParams.get("state") || "";
  const nonce = url.searchParams.get("nonce") || "";
  const requestedClientId = url.searchParams.get("client_id") || clientId;

  if (!redirectUri) {
    html(res, 400, "redirect_uri required");
    return;
  }

  const code = crypto.randomBytes(24).toString("hex");

  codes.set(code, {
    nonce,
    clientId: requestedClientId,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set("code", code);

  if (state) {
    redirect.searchParams.set("state", state);
  }

  res.writeHead(302, {
    location: redirect.toString(),
  });
  res.end();
}

async function token(req, res) {
  const body = await collectBody(req);
  const params = new URLSearchParams(body);

  const code = params.get("code") || "";
  const entry = codes.get(code);

  if (!entry || entry.expiresAt < Date.now()) {
    json(res, 400, {
      error: "invalid_grant",
    });
    return;
  }

  codes.delete(code);

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss: issuer,
    aud: entry.clientId || clientId,
    sub: "100000001",
    id: "100000001",
    telegram_id: "100000001",
    username: "dev_telegram_user",
    name: "Dev Telegram User",
    given_name: "Dev",
    family_name: "User",
    picture: `${publicIssuer}/avatar.png`,
    nonce: entry.nonce,
    iat: now,
    exp: now + 10 * 60,
  };

  json(res, 200, {
    token_type: "Bearer",
    access_token: "dev-access-token",
    expires_in: 600,
    id_token: signJwt(payload),
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, publicIssuer);

    if (req.method === "GET" && url.pathname === "/auth") {
      auth(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/token") {
      await token(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/.well-known/jwks.json") {
      json(res, 200, {
        keys: [jwk],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      json(res, 200, {
        issuer,
        authorization_endpoint: `${publicIssuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/avatar.png") {
      res.writeHead(204);
      res.end();
      return;
    }

    json(res, 404, {
      error: "not_found",
    });
  } catch (error) {
    console.error(error);

    json(res, 500, {
      error: "internal_error",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Telegram OIDC mock listening on 0.0.0.0:${port}`);
  console.log(`Issuer: ${issuer}`);
  console.log(`Public auth endpoint: ${publicIssuer}/auth`);
});
