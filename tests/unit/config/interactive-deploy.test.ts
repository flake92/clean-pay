import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const deploy = readFileSync("deploy.sh", "utf8");
const readme = readFileSync("README.md", "utf8");

describe("interactive owner deployment", () => {
  it("guides a terminal user through exactly three explicit stages", () => {
    expect(deploy).toContain("[1/3] Настройка Clean Pay");
    expect(deploy).toContain("[2/3] Подготовка Docker Compose");
    expect(deploy).toContain("[3/3] Установка и запуск");
    expect(deploy).toMatch(/if \[ "\$#" -eq 0 \] && is_interactive; then\s+command=setup/);
    expect(deploy).toContain("setup) setup");
    expect(deploy).toContain("configure|config) configure");
    expect(deploy).toContain("compose|check) prepare_compose");
    expect(deploy).toContain("install) up");
  });

  it("creates secrets safely and does not require Docker before configuration", () => {
    expect(deploy).toContain('chmod 600 "$ENV_FILE"');
    expect(deploy).toContain("stty -echo");
    expect(deploy).toContain("ensure_generated_secret REMNASHOP_AUTH_SERVICE_KEY");
    expect(deploy).toMatch(/prepare_compose\(\) \{\s+init\s+need_docker/);
    expect(deploy).toContain('replace_env NEXT_PUBLIC_APP_URL "$(env_value APP_URL)"');
    expect(deploy).toContain("bot_id=${bot_token%%:*}");

    const dispatch = deploy.slice(deploy.lastIndexOf('if [ "$#" -eq 0 ]'));
    expect(dispatch.indexOf("init) init")).toBeGreaterThan(-1);
    expect(dispatch.indexOf("init) init")).toBeLessThan(dispatch.indexOf("need_docker"));
  });

  it("validates Compose and returns after a successful install instead of trapping the owner in logs", () => {
    expect(deploy).toContain("compose config --quiet");
    expect(deploy).toContain("Clean Pay установлен и успешно прошёл healthcheck");

    const up = deploy.match(/install_services\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(up).not.toContain("logs --tail=100 -f");
    expect(up.indexOf("verify_detailed_readiness")).toBeGreaterThan(
      up.indexOf("start_verified_runtimes"),
    );
  });

  it("documents the same owner workflow without requiring manual Compose YAML", () => {
    expect(readme).toContain("## Установка: один мастер, три этапа");
    expect(readme).toContain("./deploy.sh");
    expect(readme).toContain("Писать YAML вручную");
    expect(readme).toContain("./deploy.sh configure");
    expect(readme).toContain("./deploy.sh compose");
    expect(readme).toContain("./deploy.sh install");
  });
});
