const http = require("node:http");

const port = Number(process.env.PORT || 8126);
const mailpitBaseUrl = process.env.MAILPIT_API_URL || "http://smtp:8025";
const maxBodyChars = Number(process.env.SMTP_LOG_MAX_BODY_CHARS || 12000);

function asList(value) {
  const items = Array.isArray(value) ? value : [value];

  return items
    .map((item) => item?.Address || item?.address || item?.Name || item?.name || String(item))
    .filter((item) => item && item !== "undefined" && item !== "null");
}

function pickBody(message) {
  return [
    message.Text,
    message.text,
    message.Body,
    message.body,
    message.HTML,
    message.html,
  ].find((value) => typeof value === "string" && value.trim().length > 0) || "";
}

function truncate(value) {
  if (value.length <= maxBodyChars) {
    return value;
  }

  return `${value.slice(0, maxBodyChars)}\n[truncated ${value.length - maxBodyChars} chars]`;
}

async function fetchMessage(id) {
  if (!id) {
    return null;
  }

  const response = await fetch(`${mailpitBaseUrl}/api/v1/message/${encodeURIComponent(id)}`);

  if (!response.ok) {
    throw new Error(`Mailpit message ${id} fetch failed with ${response.status}`);
  }

  return response.json();
}

async function logMessage(summary) {
  const id = summary.ID || summary.Id || summary.id;
  const message = await fetchMessage(id).catch((error) => {
    console.error(`[smtp-log] Failed to fetch full message: ${error.message}`);
    return summary;
  });

  const full = message || summary;
  const subject = full.Subject || full.subject || summary.Subject || summary.subject || "(no subject)";
  const from = asList(full.From).join(", ") || asList(summary.From).join(", ") || "(unknown)";
  const to = asList(full.To).join(", ") || asList(summary.To).join(", ") || "(unknown)";
  const body = truncate(pickBody(full));

  console.log("");
  console.log("========== SMTP MESSAGE ==========");
  console.log(`ID: ${id || "(unknown)"}`);
  console.log(`From: ${from}`);
  console.log(`To: ${to}`);
  console.log(`Subject: ${subject}`);
  console.log("Body:");
  console.log(body || "(empty)");
  console.log("======== END SMTP MESSAGE ========");
}

const server = http.createServer((request, response) => {
  if (request.method !== "POST") {
    response.writeHead(405).end();
    return;
  }

  let raw = "";

  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    raw += chunk;
  });
  request.on("end", async () => {
    try {
      const payload = JSON.parse(raw || "{}");
      const messages = Array.isArray(payload) ? payload : [payload];

      for (const message of messages) {
        await logMessage(message);
      }

      response.writeHead(204).end();
    } catch (error) {
      console.error(`[smtp-log] Webhook handling failed: ${error.message}`);
      response.writeHead(500).end();
    }
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[smtp-log] Listening on 0.0.0.0:${port}, Mailpit API: ${mailpitBaseUrl}`);
});
