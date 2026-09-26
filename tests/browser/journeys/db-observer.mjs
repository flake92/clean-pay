import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";

import pg from "pg";

const port = Number(process.env.PORT ?? "3200");
const project = process.env.CLEAN_PAY_BROWSER_DB_SCOPE ?? "";
const databaseUrl = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
if (!/^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/.test(project)) {
  throw new Error("DB observer requires an exact disposable journey project scope.");
}
if (
  databaseUrl.protocol !== "postgresql:"
  || databaseUrl.hostname !== "postgres"
  || databaseUrl.port !== "5432"
  || databaseUrl.pathname !== "/clean_pay"
  || databaseUrl.username !== "clean_pay_browser_observer"
) {
  throw new Error("DB observer refuses a database outside the owned synthetic Compose network.");
}

const { Client } = pg;
const client = new Client({ connectionString: databaseUrl.toString() });
try {
  await client.connect();
  await client.query("SET search_path TO pg_catalog, public");
  const sequences = await applicationSequenceNames();
  if (sequences.length !== 0) {
    throw new Error("Synthetic reset contract requires a schema without application sequences.");
  }
} catch (error) {
  logSanitizedError("browser_db_observer_start_failed", error);
  throw new Error("Browser DB observer could not establish its scoped database session.");
}
let resetSequence = 0;

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://browser-db-observer");
    if (request.method === "GET" && url.pathname === "/__health") {
      const snapshot = await databaseSnapshot();
      sendJson(response, 200, { status: "ok", tableCount: snapshot.tables.length });
      return;
    }
    if (request.method === "POST" && url.pathname === "/__reset") {
      const input = await readJson(request);
      if (JSON.stringify(input) !== JSON.stringify({ scope: project })) {
        sendJson(response, 422, { error: "invalid_owned_scope" });
        return;
      }
      const result = await resetOwnedState();
      sendJson(response, 200, result);
      return;
    }
    if (request.method === "GET" && url.pathname === "/__snapshot") {
      sendJson(response, 200, await databaseSnapshot());
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  } catch (error) {
    logSanitizedError("browser_db_observer_request_failed", error);
    sendJson(response, 500, { error: "observer_failure" });
  }
});

async function resetOwnedState() {
  let tables;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    tables = await applicationTableNames();
    if (tables.length === 0) throw new Error("Synthetic database contains no application tables.");
    const identifiers = tables.map(qualifiedPublicTable).join(", ");
    await client.query(`TRUNCATE TABLE ${identifiers} CASCADE`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  await flushOwnedRedis();
  resetSequence += 1;
  return {
    status: "reset",
    scopeContract: "exact-compose-project-label",
    scopeSha256: sha256(project),
    schemaSha256: sha256(tables.join("\n")),
    sequenceCount: 0,
    tableCount: tables.length,
    transaction: "truncate-public-application-tables-cascade-no-sequences",
    redis: "flush-owned-db-0",
    resetSequence,
  };
}

async function databaseSnapshot() {
  const names = await applicationTableNames();
  const tables = [];
  for (const name of names) {
    const result = await client.query(
      `SELECT COUNT(*)::bigint AS count FROM ${qualifiedPublicTable(name)}`,
    );
    tables.push({ name, count: Number(result.rows[0].count) });
  }
  return {
    schemaSha256: sha256(names.join("\n")),
    sequenceCount: 0,
    tables,
  };
}

async function applicationTableNames() {
  const result = await client.query(
    "SELECT tablename FROM pg_catalog.pg_tables "
      + "WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename",
  );
  return result.rows.map((row) => String(row.tablename));
}

async function applicationSequenceNames() {
  const result = await client.query(
    "SELECT sequencename FROM pg_catalog.pg_sequences "
      + "WHERE schemaname = 'public' ORDER BY sequencename",
  );
  return result.rows.map((row) => String(row.sequencename));
}

function flushOwnedRedis() {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "redis", port: 6379 });
    let response = "";
    const timer = setTimeout(() => socket.destroy(new Error("redis timeout")), 3_000);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write("*1\r\n$7\r\nFLUSHDB\r\n"));
    socket.on("data", (chunk) => {
      response += chunk;
      if (!response.includes("\r\n")) return;
      clearTimeout(timer);
      socket.end();
      if (response === "+OK\r\n") resolve();
      else reject(new Error("redis reset rejected"));
    });
    socket.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error("Unsafe database identifier.");
  return `"${value.replaceAll('"', '""')}"`;
}

function qualifiedPublicTable(value) {
  return `${quoteIdentifier("public")}.${quoteIdentifier(value)}`;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4_096) request.destroy(new Error("request too large"));
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  if (response.headersSent) return;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function logSanitizedError(event, error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,20}$/.test(error.code)
    ? error.code
    : null;
  process.stderr.write(`${JSON.stringify({
    event,
    class: error?.constructor?.name ?? "Error",
    code,
    messageSha256: sha256(String(error?.message ?? "unknown")),
  })}\n`);
}

server.listen(port, "0.0.0.0");
