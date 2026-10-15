import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
