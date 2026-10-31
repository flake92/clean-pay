/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IosInstallGuide } from "@/frontend/components/ios-install-guide";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("IosInstallGuide", () => {
  let root: Root;
  const container = document.createElement("div");

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("opens on the body, outside the animated card, and follows the theme", async () => {
    const onClose = vi.fn();
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(IosInstallGuide, { onClose })));

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.parentElement).toBe(document.body);
    expect(container.children).toHaveLength(0);
    expect(dialog?.querySelector<HTMLElement>(":scope > div")?.style.background)
      .toBe("var(--surface-card)");
    expect(dialog?.textContent).toContain("•••");
    expect(dialog?.textContent).toContain("Открыть как веб‑приложение");
    expect(dialog?.textContent).toContain("Редактировать действия");

    document.querySelector<HTMLButtonElement>('[aria-label="Закрыть инструкцию"]')?.click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
