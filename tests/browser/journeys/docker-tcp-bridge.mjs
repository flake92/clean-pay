import { spawn } from "node:child_process";
import net from "node:net";

const transport = process.env.CLEAN_PAY_BROWSER_DOCKER_TRANSPORT?.trim() || "npipe";
if (!new Set(["npipe", "wsl-raw"]).has(transport)) {
  throw new Error("CLEAN_PAY_BROWSER_DOCKER_TRANSPORT must be npipe or wsl-raw.");
}
const project = required(
  "CLEAN_PAY_BROWSER_COMPOSE_PROJECT",
  /^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/,
);
const providerContainer = requiredContainer("CLEAN_PAY_BROWSER_PROVIDER_CONTAINER");
const proxyContainer = requiredContainer("CLEAN_PAY_BROWSER_PROXY_CONTAINER");
const proxyListenHost = optional(
  "CLEAN_PAY_BROWSER_BRIDGE_PROXY_BIND",
  "127.0.0.2",
  /^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/,
);
const providerListenPort = Number(optional(
  "CLEAN_PAY_BROWSER_BRIDGE_PROVIDER_PORT",
  "13100",
  /^\d{4,5}$/,
));
if (providerListenPort > 65_535) {
  throw new Error("CLEAN_PAY_BROWSER_BRIDGE_PROVIDER_PORT is outside the TCP port range.");
}
const dockerInvocation = dockerCommand();
await assertOwnedService(proxyContainer, "browser-proxy");
await assertOwnedService(providerContainer, "browser-provider-mock");
const activeChildren = new Set();
const servers = [
  bridge({
    listenHost: proxyListenHost,
    listenPort: 443,
    container: proxyContainer,
    targetPort: 443,
    command: ["nc", "127.0.0.1", "443"],
  }),
  bridge({
    listenHost: "127.0.0.1",
    listenPort: providerListenPort,
    container: providerContainer,
    targetPort: 3100,
    command: ["nc", "127.0.0.1", "3100"],
  }),
];

await Promise.all(servers.map((server) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(server.cleanPayListenPort, server.cleanPayListenHost, () => {
    server.off("error", reject);
    resolve();
  });
})));
process.stdout.write("clean-pay journey TCP bridge ready\n");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    for (const server of servers) server.close();
    for (const child of activeChildren) child.kill();
    process.exitCode = 0;
  });
}

function bridge({ listenHost, listenPort, container, targetPort, command }) {
  const server = net.createServer({ allowHalfOpen: false }, (socket) => {
    socket.setNoDelay(true);
    const child = spawn(dockerInvocation.command, [
      ...dockerInvocation.args,
      "container",
      "exec",
      "-i",
      container,
      ...command,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    activeChildren.add(child);
    let clientBytes = 0;
    let targetBytes = 0;
    let targetPrefix = Buffer.alloc(0);
    socket.on("data", (chunk) => { clientBytes += chunk.length; });
    child.stdout.on("data", (chunk) => {
      targetBytes += chunk.length;
      if (targetPrefix.length < 16) {
        targetPrefix = Buffer.concat([targetPrefix, chunk]).subarray(0, 16);
      }
    });
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 1024) stderr += chunk.slice(0, 1024 - stderr.length);
    });
    const close = () => {
      activeChildren.delete(child);
      if (!socket.destroyed) socket.destroy();
    };
    child.once("error", (error) => {
      diagnostic(`journey bridge child ${targetPort} error ${error.code ?? error.name}`);
      close();
    });
    child.stdin.once("error", (error) => {
      diagnostic(`journey bridge stdin ${targetPort} error ${error.code ?? error.name}`);
    });
    child.stdout.once("end", () => {
      diagnostic(`journey bridge stdout ${targetPort} ended`);
    });
    child.once("exit", (code, signal) => {
      if (process.env.CLEAN_PAY_BROWSER_BRIDGE_DIAGNOSTICS === "1") {
        process.stderr.write(
          `journey bridge child ${targetPort} exited (${code ?? signal ?? "unknown"})`
          + `${stderr ? `: ${stderr.replace(/\s+/g, " ").trim()}` : ""}\n`,
        );
      }
      if (code !== 0 && signal !== "SIGTERM") {
        process.stderr.write(
          `journey bridge target ${targetPort} closed (${code ?? signal ?? "unknown"})`
          + `${stderr ? `: ${stderr.replace(/\s+/g, " ").trim()}` : ""}\n`,
        );
      }
      close();
    });
    socket.once("error", (error) => {
      diagnostic(`journey bridge socket ${targetPort} error ${error.code ?? error.name}`);
      child.kill();
    });
    socket.once("end", () => {
      diagnostic(`journey bridge socket ${targetPort} ended`);
    });
    socket.once("close", () => {
      if (process.env.CLEAN_PAY_BROWSER_BRIDGE_DIAGNOSTICS === "1") {
        process.stderr.write(
          `journey bridge target ${targetPort} bytes client=${clientBytes} target=${targetBytes}`
          + ` prefix=${targetPrefix.toString("hex")}\n`,
        );
      }
      child.stdin.end();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    });
  });
  server.cleanPayListenHost = listenHost;
  server.cleanPayListenPort = listenPort;
  return server;
}

async function assertOwnedService(container, service) {
  const output = await runReadOnly([
    "container",
    "inspect",
    "--format",
    '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}',
    container,
  ]);
  if (output.trim() !== `${project}|${service}`) {
    throw new Error(`Refusing bridge target outside ${project}/${service}.`);
  }
}

function runReadOnly(args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(dockerInvocation.command, [...dockerInvocation.args, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4_096) stdout += chunk.slice(0, 4_096 - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 1_024) stderr += chunk.slice(0, 1_024 - stderr.length);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(
        `Docker bridge ownership query failed (${code}): ${stderr.replace(/\s+/g, " ").trim()}`,
      ));
    });
  });
}

function dockerCommand() {
  if (transport === "npipe") {
    const host = process.env.CLEAN_PAY_BROWSER_DOCKER_HOST
      ?? "npipe:////./pipe/docker_engine_linux";
    if (!/^npipe:\/\/\/\/\.\/pipe\/[A-Za-z0-9_.-]+$/.test(host)) {
      throw new Error("CLEAN_PAY_BROWSER_DOCKER_HOST must be an explicit Windows named pipe.");
    }
    return { command: "docker.exe", args: ["--host", host] };
  }

  const clientRoot = required(
    "CLEAN_PAY_BROWSER_WSL_CLIENT_ROOT",
    /^\/proc\/[1-9][0-9]*\/root$/,
  );
  const engineSocket = required(
    "CLEAN_PAY_BROWSER_WSL_ENGINE_SOCKET",
    /^unix:\/\/\/proc\/[1-9][0-9]*\/root\/run\/docker\.raw\.sock$/,
  );
  return {
    command: "wsl.exe",
    args: [
      "-d",
      "docker-desktop",
      "--",
      `${clientRoot}/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2`,
      "--library-path",
      `${clientRoot}/lib/x86_64-linux-gnu:${clientRoot}/usr/lib/x86_64-linux-gnu`,
      `${clientRoot}/usr/bin/docker`,
      "-H",
      engineSocket,
    ],
  };
}

function requiredContainer(name) {
  return required(name, /^[a-f0-9]{12,64}$/);
}

function required(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) {
    throw new Error(`${name} is required and invalid.`);
  }
  return value;
}

function optional(name, fallback, pattern) {
  const value = process.env[name]?.trim() || fallback;
  if (!pattern.test(value)) throw new Error(`${name} is invalid.`);
  return value;
}

function diagnostic(message) {
  if (process.env.CLEAN_PAY_BROWSER_BRIDGE_DIAGNOSTICS === "1") {
    process.stderr.write(`${message}\n`);
  }
}
