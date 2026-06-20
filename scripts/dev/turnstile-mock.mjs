import http from "node:http";

const port = Number(process.env.PORT || 8787);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.method === "POST" && url.pathname === "/turnstile/v0/siteverify") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ success: true, challenge_ts: new Date().toISOString(), hostname: "dev.clean-pay.local" }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ success: false, error_codes: ["not-found"] }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Turnstile mock listening on ${port}`);
});
