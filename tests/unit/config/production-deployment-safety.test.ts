import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const productionDeploymentFiles = [
  "deploy.sh",
  "start.sh",
  "docker-compose.yml",
  "docker-compose.remnashop.yml",
  ...globSync("deploy/**/*.{sh,mjs,yml,yaml}"),
];

const destructiveVolumePatterns = [
  [
    "force recreation",
    /(^|[^\w-])--force-recreate(?!=(?:false\b|"false"|'false'))(?=$|[^\w-])/i,
  ],
  [
    "Compose down with the long volume option",
    /\bdown\b[^;\r\n]{0,256}?(^|[^\w-])--volumes(?!=(?:false\b|"false"|'false'))(?=$|[^\w-])/im,
  ],
  [
    "system prune with volumes",
    /\bsystem\b[^;\r\n]{0,128}?\bprune\b[^;\r\n]{0,128}?(^|[^\w-])--volumes(?!=(?:false\b|"false"|'false'))(?=$|[^\w-])/im,
  ],
  [
    "volume removal or pruning",
    /\bvolume(?:\s|["'`,()[\]{}:])+(?:prune|remove|rm)\b/,
  ],
  [
    "compose down with the short volume option",
    /\bdown\b[^;\r\n]{0,256}?(^|[^\w-])-v(?!=(?:false\b|"false"|'false'))(?=$|[^\w-])/im,
  ],
] as const;

function withoutComments(source: string) {
  let result = "";
  let quote = "";
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (quote) {
      result += character;
      if (character === "\\" && quote !== "'") {
        if (next) {
          result += next;
          index += 1;
        }
      } else if (character === quote) {
        if (quote === "'" && next === "'") {
          result += next;
          index += 1;
        } else {
          quote = "";
        }
      }
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (character === "/" && next === "/" && source[index - 1] !== ":") {
      while (index < source.length && source[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (
      character === "#"
      && (index === 0 || /\s/.test(source[index - 1] ?? ""))
    ) {
      while (index < source.length && source[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }

    result += character;
  }

  return result;
}

function destructiveVolumeOperations(source: string, file = "inline") {
  const shellContinuations = withoutComments(source).replace(/\\\r?\n/g, " ");
  const normalized = file.endsWith(".mjs")
    ? shellContinuations.replace(/\r?\n/g, " ")
    : shellContinuations;

  return destructiveVolumePatterns
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([name]) => name);
}

function topLevelYamlSection(source: string, name: string) {
  const lines = withoutComments(source).replace(/\r/g, "").split("\n");
  const startPattern = new RegExp(`^${name}:\\s*`);
  const start = lines.findIndex((line) => startPattern.test(line));

  if (start < 0) return "";
  if (lines[start].slice(lines[start].indexOf(":") + 1).trim()) return lines[start];

  const endOffset = lines.slice(start + 1).findIndex((line) => /^\S/.test(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;

  return lines.slice(start, end).join("\n");
}

function composeService(source: string, serviceName: string) {
  const services = topLevelYamlSection(source, "services");
  const lines = services.split("\n");
  const servicePattern = new RegExp(`^  ${serviceName}:\\s*`);
  const start = lines.findIndex((line) => servicePattern.test(line));

  if (start < 0) return "";

  const endOffset = lines
    .slice(start + 1)
    .findIndex((line) => /^  [\w-]+:\s*$/.test(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;

  return lines.slice(start, end).join("\n");
}

function composeServiceProperty(service: string, propertyName: string) {
  const lines = service.split("\n");
  const inlinePropertyPattern = new RegExp(
    `(?:^|[{,\\s])['\"]?${propertyName}['\"]?\\s*:`,
  );
  const inlineService = lines[0]?.slice(lines[0].indexOf(":") + 1).trim() ?? "";
  if (inlinePropertyPattern.test(inlineService)) return inlineService;

  const propertyPattern = new RegExp(`^    ['\"]?${propertyName}['\"]?:`);
  const start = lines.findIndex((line) => propertyPattern.test(line));

  if (start < 0) return "";

  const endOffset = lines
    .slice(start + 1)
    .findIndex((line) => /^    [\w-]+:/.test(line));
  const end = endOffset < 0 ? lines.length : start + 1 + endOffset;

  return lines.slice(start, end).join("\n");
}

function hasNamedVolumeMount(
  service: string,
  volumeName: string,
  containerPath: string,
) {
  const volumes = withoutComments(composeServiceProperty(service, "volumes"));
  const escapedVolume = volumeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedPath = containerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const shortSyntax = new RegExp(
    `(?:^|[\\s[,])['\"]?${escapedVolume}:${escapedPath}`
    + `(?::[a-zA-Z,]+)?['\"]?(?=$|[\\s,\\]])`,
  );
  if (shortSyntax.test(volumes)) return true;

  return volumes.split(/(?=^\s*-\s+)/m).some((entry) => {
    const propertyValue = (name: string, value: string) => new RegExp(
      `(?:^|[{,\\s-])${name}\\s*:\\s*['\"]?${value}['\"]?(?=$|[,}\\s])`,
    ).test(entry);

    return propertyValue("type", "volume")
      && propertyValue("source", escapedVolume)
      && propertyValue("target", escapedPath);
  });
}

function declaresNamedVolume(source: string, volumeName: string) {
  const volumes = topLevelYamlSection(source, "volumes");
  const escapedVolume = volumeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return new RegExp(
    `(?:^|[{,\\s])${escapedVolume}:\\s*(?:$|[{},\\s])`,
    "m",
  ).test(volumes);
}

describe("production deployment state safety", () => {
  it("recognizes every supported destructive Docker volume spelling", () => {
    for (const command of [
      "docker compose down -v",
      "docker compose down --remove-orphans -v",
      "docker compose down --volumes",
      "docker compose down --remove-orphans --volumes",
      "docker system prune --volumes",
      "docker volume prune",
      "docker volume rm clean-pay-prod_postgres-data",
      "docker volume remove clean-pay-prod_redis-data",
      'runDocker(["volume", "rm", volumeName])',
      'composeArgs("down", "-v")',
      `runDocker([
        "compose",
        "down",
        "--volumes",
      ])`,
    ]) {
      expect(destructiveVolumeOperations(command, "fixture.mjs"), command).not.toEqual([]);
    }

    expect(destructiveVolumeOperations("docker builder prune -af")).toEqual([]);
    expect(destructiveVolumeOperations("docker image prune -f")).toEqual([]);
    expect(destructiveVolumeOperations("docker compose config --volumes")).toEqual([]);
    expect(destructiveVolumeOperations("docker compose down --volumes=false")).toEqual([]);
    expect(destructiveVolumeOperations("docker compose up --force-recreate=false")).toEqual([]);
    expect(destructiveVolumeOperations("docker compose down -v=false")).toEqual([]);
    expect(destructiveVolumeOperations('docker compose down --volumes="false"')).toEqual([]);
    expect(destructiveVolumeOperations(
      "docker compose up --force-recreate='false'",
    )).toEqual([]);
    expect(destructiveVolumeOperations("# Never run docker compose down --volumes")).toEqual([]);
  });

  it("keeps destructive volume operations out of production rollout files", () => {
    for (const file of productionDeploymentFiles) {
      expect(
        destructiveVolumeOperations(readFileSync(file, "utf8"), file),
        file,
      ).toEqual([]);
    }
  });

  it("does not mistake comments or another service for a stateful mount", () => {
    const misleadingCompose = `services:
  postgres:
    environment:
      NOTE: postgres-data:/var/lib/postgresql/data
    volumes:
      # - postgres-data:/var/lib/postgresql/data
  redis:
    volumes: [postgres-data:/var/lib/postgresql/data]
volumes:
  postgres-data:
`;

    expect(
      hasNamedVolumeMount(
        composeService(misleadingCompose, "postgres"),
        "postgres-data",
        "/var/lib/postgresql/data",
      ),
    ).toBe(false);

    expect(hasNamedVolumeMount(
      "  postgres:\n    volumes: [] # postgres-data:/var/lib/postgresql/data",
      "postgres-data",
      "/var/lib/postgresql/data",
    )).toBe(false);

    expect(hasNamedVolumeMount(
      `  postgres:
    volumes:
      - type: volume
        source: postgres-data
        target: /var/lib/postgresql/data`,
      "postgres-data",
      "/var/lib/postgresql/data",
    )).toBe(true);
    expect(hasNamedVolumeMount(
      "  postgres:\n    volumes: ['postgres-data:/var/lib/postgresql/data:rw']",
      "postgres-data",
      "/var/lib/postgresql/data",
    )).toBe(true);
  });

  it("persists PostgreSQL and Redis data in both production Compose paths", () => {
    const rootStart = readFileSync("start.sh", "utf8");
    expect(rootStart).toContain('COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"');

    for (const file of ["docker-compose.yml", "deploy/prod/docker-compose.yml"]) {
      const compose = readFileSync(file, "utf8");
      const postgres = composeService(compose, "postgres");
      const redis = composeService(compose, "redis");

      expect(postgres, `${file}: postgres service`).not.toBe("");
      expect(redis, `${file}: redis service`).not.toBe("");
      expect(
        hasNamedVolumeMount(
          postgres,
          "postgres-data",
          "/var/lib/postgresql/data",
        ),
        `${file}: postgres-data mount`,
      ).toBe(true);
      expect(
        hasNamedVolumeMount(redis, "redis-data", "/data"),
        `${file}: redis-data mount`,
      ).toBe(true);
      expect(
        declaresNamedVolume(compose, "postgres-data"),
        `${file}: postgres-data declaration`,
      ).toBe(true);
      expect(
        declaresNamedVolume(compose, "redis-data"),
        `${file}: redis-data declaration`,
      ).toBe(true);
    }
  });

  it("keeps production Compose overlays from replacing stateful storage", () => {
    for (const file of [
      "docker-compose.remnashop.yml",
      "deploy/prod/docker-compose.debug.yml",
    ]) {
      const overlay = readFileSync(file, "utf8");
      const executableYaml = withoutComments(overlay);

      for (const serviceName of ["postgres", "redis"]) {
        const service = composeService(overlay, serviceName);
        expect(
          composeServiceProperty(service, "volumes"),
          `${file}: ${serviceName} volumes override`,
        ).toBe("");
      }

      expect(topLevelYamlSection(overlay, "volumes"), `${file}: volume declarations`)
        .toBe("");
      expect(executableYaml, `${file}: any volumes override`).not.toMatch(
        /(?:^|[{,\s])["']?volumes["']?\s*:/,
      );
      expect(executableYaml, `${file}: Compose reset tags`).not.toMatch(
        /!(?:override|reset)\b/,
      );
    }

    for (const unsafeOverlay of [
      "services:\n  postgres: # override\n    volumes: [other:/data]",
      "services: { postgres: { volumes: [other:/data] } }",
      "services:\n  postgres:\n    'volumes': [other:/data]",
      "x-state-loss: &state-loss\n  volumes: [/data]\nservices:\n  redis:\n    <<: *state-loss",
    ]) {
      expect(withoutComments(unsafeOverlay)).toMatch(
        /(?:^|[{,\s])["']?volumes["']?\s*:/,
      );
    }

    expect(withoutComments("# Never use !reset or volumes: here")).not.toMatch(
      /!(?:override|reset)\b|(?:^|[{,\s])["']?volumes["']?\s*:/,
    );
  });
});
