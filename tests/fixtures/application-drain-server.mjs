import http from "node:http";

const mode = process.env.CLEAN_PAY_TEST_APPLICATION_DRAIN_MODE;

if (mode === "early-signal") {
  process.emit("SIGTERM", "SIGTERM");
  setTimeout(() => process.exit(9), 2_000);
} else {
  const server = http.createServer(async (request, response) => {
    process.send?.({ event: "admitted", path: request.url });

    if (request.url === "/hang") {
      await new Promise(() => {});
    } else {
      let bodyBytes = 0;
      for await (const chunk of request) {
        bodyBytes += chunk.byteLength;
      }
      response.statusCode = 200;
      response.setHeader("Connection", "close");
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end(`accepted:${bodyBytes}`);
    }
  });

  process.on("SIGTERM", () => {
    server.close((error) => {
      process.stderr.write(
        `event=fixture_framework_cleanup_completed error=${Boolean(error)}\n`,
      );
      process.exit(error ? 1 : 0);
    });
  });

  process.on("message", (message) => {
    if (message === "signal") {
      process.emit("SIGTERM", "SIGTERM");
      process.send?.({ event: "signalled" });
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") process.exit(2);
    process.send?.({
      event: "ready",
      inheritedNodeOptions: process.env.NODE_OPTIONS ?? null,
      internalNodeOptionsPresent: Object.hasOwn(
        process.env,
        "CLEAN_PAY_INHERITED_NODE_OPTIONS",
      ),
      port: address.port,
    });
  });
}
