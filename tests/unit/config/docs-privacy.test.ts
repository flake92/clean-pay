import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const docsDirectory = "docs";
const allowedExternalHosts = new Set([
  "github.com",
  "oauth.telegram.org",
  "telegram.org",
  "core.telegram.org",
  "developers.cloudflare.com",
  "docs.docker.com",
  "postgresql.org",
  "www.postgresql.org",
  "prisma.io",
  "www.prisma.io",
  "w3.org",
  "www.w3.org",
]);

const forbiddenPatterns = [
  {
    name: "absolute Windows path",
    pattern: /\b[A-Za-z]:[\\/][^\s`]+/u,
  },
  {
    name: "absolute operational Unix path",
    pattern: /\/(?:home|opt|root|srv|var\/lib)\/[A-Za-z0-9._/-]+/u,
  },
  {
    name: "full revision, digest, or checksum",
    pattern: /\b(?:sha256:)?[0-9a-f]{32,64}\b/iu,
  },
  {
    name: "timestamped deployment or backup identifier",
    pattern: /\b\d{8}T\d{6}Z\b/u,
  },
  {
    name: "CUID-like internal object identifier",
    pattern: /\bcm[a-z0-9]{20,}\b/iu,
  },
  {
    name: "IPv4 address",
    pattern: /(?<![0-9])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9])/u,
  },
] as const;

function markdownFiles() {
  return readdirSync(docsDirectory)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(docsDirectory, name));
}

describe("documentation privacy", () => {
  it("does not contain deployment-specific identifiers", () => {
    const offenders = markdownFiles().flatMap((file) =>
      readFileSync(file, "utf8")
        .split(/\r?\n/u)
        .flatMap((line, index) =>
          forbiddenPatterns
            .filter(({ pattern }) => pattern.test(line))
            .map(({ name }) => `${file}:${index + 1}: ${name}`),
        ),
    );

    expect(offenders).toEqual([]);
  });

  it("allows only example or explicitly approved external hosts", () => {
    const offenders: string[] = [];
    const urlPattern = /https?:\/\/[^\s)`>"']+/gu;

    for (const file of markdownFiles()) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/u);

      for (const [index, line] of lines.entries()) {
        for (const match of line.matchAll(urlPattern)) {
          const host = new URL(match[0]).hostname.toLowerCase();
          const allowed =
            host === "example.com" ||
            host.endsWith(".example.com") ||
            allowedExternalHosts.has(host);

          if (!allowed) {
            offenders.push(`${file}:${index + 1}: unapproved external host`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("does not contain real e-mail addresses", () => {
    const emailPattern = /\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/giu;
    const offenders: string[] = [];

    for (const file of markdownFiles()) {
      const lines = readFileSync(file, "utf8").split(/\r?\n/u);

      for (const [index, line] of lines.entries()) {
        for (const match of line.matchAll(emailPattern)) {
          const host = match[1]?.toLowerCase();

          if (host !== "example.com" && !host?.endsWith(".example.com")) {
            offenders.push(`${file}:${index + 1}: non-example e-mail`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
