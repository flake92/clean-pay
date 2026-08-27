import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("allowed accessibility-only semantic changes", () => {
  it("uses the Russian PrimeReact ARIA locale without replacing visible copy", () => {
    const providers = source("src/app/providers.tsx");

    expect(providers).toContain("const russianPrimeAria = {");
    expect(providers).toContain('addLocale("ru", { aria: russianPrimeAria });');
    expect(providers).toContain('passwordShow: "Показать пароль"');
    expect(providers).toContain('passwordHide: "Скрыть пароль"');
    expect(providers).toContain('<PrimeReactProvider value={{ locale: "ru" }}>');
    expect(providers).not.toMatch(/\b(?:weak|medium|strong|passwordPrompt):/u);
  });

  it("provides a normally invisible, keyboard-visible skip link", () => {
    const layout = source("src/frontend/layout/layout.tsx");
    const styles = source("src/app/globals.css");

    expect(layout).toContain('className="skip-link" href="#main-content"');
    expect(layout).toContain('id="main-content" tabIndex={-1}');
    expect(styles).toContain(".skip-link:focus-visible");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("transform: translateY(calc(-100% - 2rem))");
  });

  it("keeps logos decorative and cabinet section headings structurally ordered", () => {
    for (const path of [
      "src/frontend/layout/AppTopbar.tsx",
      "src/frontend/layout/AppFooter.tsx",
      "src/frontend/components/auth-shell.tsx",
    ]) {
      expect(source(path), path).toContain('alt=""');
    }

    for (const path of [
      "src/frontend/components/cabinet-panel.tsx",
      "src/frontend/components/cabinet-responsive-sections.tsx",
    ]) {
      const contents = source(path);
      expect(contents, path).not.toContain("<h5");
      expect(contents, path).toContain('<h2 className="text-xl"');
    }
  });

  it("gives each repeated passkey delete control a distinct accessible name", () => {
    const panel = source("src/frontend/components/link-account-panel.tsx");

    expect(panel).toContain("passkeys.map((credential, index)");
    expect(panel).toContain('aria-label={`Удалить ключ ${credential.name ?? "Ключ доступа"} ${index + 1}`}');
  });
});
