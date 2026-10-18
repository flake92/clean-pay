import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { posixShell, shellFunctionFrom, shellIntegrationTimeout, shellPath } from "../../helpers/posix-shell";

const menu = readFileSync("menu.sh", "utf8");
const readme = readFileSync("README.md", "utf8");

function functionBody(name: string): string {
  const start = menu.indexOf(`\n${name}() {\n`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = menu.indexOf("\n}\n", start + 1);
  expect(end, `${name} is closed`).toBeGreaterThan(start);
  return menu.slice(start, end);
}

function expectBefore(body: string, first: string, second: string) {
  const firstIndex = body.indexOf(first);
  const secondIndex = body.indexOf(second);
  expect(firstIndex, `${first} is present`).toBeGreaterThan(-1);
  expect(secondIndex, `${second} is present`).toBeGreaterThan(-1);
  expect(firstIndex, `${first} runs before ${second}`).toBeLessThan(secondIndex);
}

describe("operator menu", () => {
  it("runs as a private, fail-closed bash program", () => {
    expect(menu.startsWith("#!/usr/bin/env bash\n")).toBe(true);
    expect(menu).toContain("set -uo pipefail");
    expect(menu).toContain("umask 077");
    // The checkout is replaced during updates, so the menu re-executes from a copy.
    expect(menu).toContain('CLEAN_PAY_MENU_COPY=$menu_copy exec bash "$menu_copy"');
    expect(menu).toContain("( set -euo pipefail; \"$@\" )");
  });

  it("takes a verified full backup before every global action", () => {
    expectBefore(functionBody("cp_update"), "require_backup", 'checkout --quiet --detach "$target"');
    expectBefore(functionBody("cp_install"), "require_backup", 'sh "$DEPLOY_SCRIPT" setup');
    expectBefore(functionBody("rs_update"), "require_backup", 'mv -f -- "$RS_COMPOSE.new" "$RS_COMPOSE"');
    expectBefore(functionBody("rs_install"), "require_backup", "rs_build_image");

    const backup = functionBody("backup_create");
    expect(backup).toContain("verify_dump");
    expect(backup).toContain("SHA256SUMS");
    expect(functionBody("require_backup")).toContain("действие отменено, ничего не изменено");
  });

  it("delegates Clean Pay changes to the reviewed deploy.sh stages", () => {
    const update = functionBody("cp_update");
    expectBefore(update, 'sh "$DEPLOY_SCRIPT" build', "type_to_confirm ОБНОВИТЬ");
    expectBefore(update, "type_to_confirm ОБНОВИТЬ", 'sh "$DEPLOY_SCRIPT" install');
    expect(update).toContain("автоматический откат кода запрещён");
    // Release fields are written only through the reviewed credential-file guard.
    expect(functionBody("set_cp_env")).toContain("credential-env-set");
  });

  it("runs Remnashop migrations explicitly and keeps the previous image", () => {
    const update = functionBody("rs_update");
    expectBefore(update, "alembic_head", "require_backup");
    expectBefore(update, "rs_compose stop", "remnashop-migration");
    expect(update).toContain("rs_rollback");
    expect(update).toContain("Прежний образ сохранён");
  });

  it.skipIf(!posixShell)(
    "carries Remnashop health checks from the new release into an existing compose",
    () => {
      const block = (indent: string, kind: string, lines: string[]) =>
        [`${indent}healthcheck:`, `${indent}  test: ["CMD", "python", "-m", "src.infrastructure.healthcheck", "${kind}"]`,
          ...lines.map((line) => `${indent}  ${line}`)].join("\n");
      const current = [
        "services:",
        "  remnashop-db:",
        "    healthcheck:",
        '      test: ["CMD-SHELL", "pg_isready"]',
        "      interval: 3s",
        "  remnashop:",
        "    image: remnashop:clean-pay-prod-new",
        block("    ", "web", ["interval: 30s", "timeout: 10s", "retries: 3", "start_period: 1m"]),
        "    restart: always",
        "  remnashop-taskiq-worker:",
        block("    ", "taskiq", ["interval: 30s", "timeout: 10s", "retries: 3", "start_period: 3m"]),
        "  remnashop-taskiq-scheduler:",
        block("    ", "taskiq", ["interval: 30s", "timeout: 10s", "retries: 3", "start_period: 3m"]),
        "",
      ].join("\n");
      // the release template uses a different indentation and an extra comment line
      const template = [
        "services:",
        "  remnashop:",
        "      healthcheck:",
        '        test: ["CMD", "python", "-m", "src.infrastructure.healthcheck", "web"]',
        "        # Each probe is a new process",
        "        interval: 120s",
        "        timeout: 10s",
        "        retries: 3",
        "        start_period: 1m",
        "        start_interval: 10s",
        "  remnashop-taskiq-worker:",
        "      healthcheck:",
        '        test: ["CMD", "python", "-m", "src.infrastructure.healthcheck", "taskiq"]',
        "        interval: 300s",
        "        timeout: 10s",
        "        retries: 3",
        "        start_period: 3m",
        "        start_interval: 10s",
        "",
      ].join("\n");
      const dir = mkdtempSync(join(tmpdir(), "clean-pay-rs-hc-"));
      try {
        const write = (name: string, text: string) => {
          writeFileSync(join(dir, name), text);
          return shellPath(join(dir, name));
        };
        const run = (templateText: string, composeText: string, drop: string) => {
          const result = spawnSync(
            posixShell!,
            ["-c", `${shellFunctionFrom(menu, "rs_sync_healthchecks")}\nrs_sync_healthchecks "$T" "$C" "$D"`],
            {
              encoding: "utf8",
              env: { ...process.env, T: write("t.yml", templateText), C: write("c.yml", composeText), D: drop },
            },
          );
          expect(result.status, result.stderr).toBe(0);
          return result.stdout;
        };

        const updated = run(template, current, "0");
        expect(updated).toBe([
          "services:",
          "  remnashop-db:",
          "    healthcheck:",
          '      test: ["CMD-SHELL", "pg_isready"]',
          "      interval: 3s",
          "  remnashop:",
          "    image: remnashop:clean-pay-prod-new",
          block("    ", "web", ["interval: 120s", "timeout: 10s", "retries: 3", "start_period: 1m", "start_interval: 10s"]),
          "    restart: always",
          "  remnashop-taskiq-worker:",
          block("    ", "taskiq", ["interval: 300s", "timeout: 10s", "retries: 3", "start_period: 3m", "start_interval: 10s"]),
          "  remnashop-taskiq-scheduler:",
          block("    ", "taskiq", ["interval: 300s", "timeout: 10s", "retries: 3", "start_period: 3m", "start_interval: 10s"]),
          "",
        ].join("\n"));
        // idempotent on an already updated compose
        expect(run(template, updated, "0")).toBe(updated);
        // Docker Engine < 25 does not know start_interval
        expect(run(template, current, "1")).not.toContain("start_interval");
        expect(run(template, current, "1")).toContain("interval: 300s");
        // releases without these health checks leave compose untouched
        expect(run("services:\n  remnashop:\n    image: x\n", current, "0")).toBe(current);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
    shellIntegrationTimeout,
  );

  it("syncs Remnashop health checks inside the guarded compose switch", () => {
    const update = functionBody("rs_update");
    expectBefore(update, "require_backup", "rs_sync_healthchecks");
    expectBefore(update, "rs_sync_healthchecks", "rs_compose config --quiet");
    expect(update).toContain('git --git-dir="$REMNASHOP_SOURCES" show "$target:docker-compose.prod.internal.yml"');
  });

  it("refuses Remnashop versions without the Clean Pay integration before building", () => {
    expectBefore(functionBody("rs_update"), 'rs_check_compatible "$target"', "rs_build_image");
    expectBefore(functionBody("rs_install"), 'rs_check_compatible "$target"', "rs_build_image");
    // the floor is the one deploy.sh enforces through the rollout preflight
    expect(functionBody("rs_check_compatible")).toContain("prepare-remnashop-rollout.sh");
    expect(functionBody("rs_check_compatible")).toContain("notification-preferences");
    // the fork only carries upstream tags, so the Remnashop prompts list branches only
    expect(menu).not.toContain('show_remote_refs "$REMNASHOP_SOURCES" origin\n');
    expect(menu.match(/show_remote_refs "\$REMNASHOP_SOURCES" origin branches/g)).toHaveLength(2);
  });

  it("updates Remnawave only within the required version after a full backup", () => {
    expect(menu).toContain("REMNAWAVE_MIN_VERSION=2.8.0");
    expect(menu).toContain("REMNANODE_MIN_VERSION=2.8.0");
    const update = functionBody("rw_update");
    // the pull happens while the panel works; the switch only after the backup and the typed word
    expectBefore(update, 'docker pull "$image"', "require_backup before-remnawave-update");
    expectBefore(update, 'version_ge "$target" "$REMNAWAVE_MIN_VERSION"', "require_backup before-remnawave-update");
    expectBefore(update, "require_backup before-remnawave-update", "type_to_confirm ОБНОВИТЬ");
    expectBefore(update, "type_to_confirm ОБНОВИТЬ", 'rw_compose up -d --no-deps --pull never "$service"');
    // any exit before the switch puts the tag back on the running image
    expectBefore(update, "trap \"docker tag $old_id $image", "require_backup before-remnawave-update");
    expectBefore(update, "trap - EXIT", 'rw_compose up -d --no-deps --pull never "$service"');
    expect(update).toContain("Смена мажорной версии");
    expect(update).toContain("rw_wait_healthy");
    // the backup covers the panel database when it runs on this server
    expect(functionBody("backup_create")).toContain('dump_database "$RW_DB" "$dir/remnawave.dump"');
  });

  it.skipIf(!posixShell)(
    "compares Remnawave versions numerically",
    () => {
      const check = (a: string, b: string) =>
        spawnSync(posixShell!, ["-c", `${shellFunctionFrom(menu, "version_ge")}\nversion_ge "$A" "$B"`], {
          env: { ...process.env, A: a, B: b },
        }).status;
      expect(check("2.8.0", "2.8.0")).toBe(0);
      expect(check("2.10.1", "2.8.0")).toBe(0);
      expect(check("2.7.12", "2.8.0")).toBe(1);
      expect(check("1.9.9", "2.8.0")).toBe(1);
    },
    shellIntegrationTimeout,
  );

  it("documents the Remnawave and remnanode requirement", () => {
    expect(readme).toContain("Remnawave **2.8.0** или новее");
    expect(readme).toContain("remnanode 2.8.0");
    expect(readme).toContain("Обновить Remnawave");
  });

  it("never runs destructive cleanup or restores data on its own", () => {
    expect(menu).not.toMatch(/down\s+-v/);
    expect(menu).not.toContain("system prune");
    expect(menu).not.toContain("volume rm");
    expect(menu).not.toMatch(/rm -rf -- "\$(?!\{staging:\?\})/);
    // Restore overwrites live data: the menu prints the commands instead of running them.
    const restore = functionBody("show_restore");
    expect(restore).toContain("Меню только показывает команды");
    expect(restore.replace(/cat <<EOF[\s\S]*?\nEOF/g, "")).not.toContain("pg_restore");
  });

  it("is documented for the owner", () => {
    expect(readme).toContain("## Меню управления");
    expect(readme).toContain("./menu.sh");
    expect(readme).toContain("./menu.sh backup nightly");
  });
});
