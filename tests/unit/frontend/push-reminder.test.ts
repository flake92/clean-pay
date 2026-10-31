/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const controller = vi.hoisted(() => ({
  enable: vi.fn(async () => undefined),
  message: null,
  pending: false,
  status: "off",
}));

vi.mock("@/frontend/hooks/use-push-notifications-controller", () => ({
  usePushNotificationsController: () => controller,
}));
vi.mock("@/frontend/components/prime/link-button", () => ({ LinkButton: () => null }));
vi.mock("@/frontend/components/sakai/form-foundation", () => ({
  Button: ({ "aria-label": label, onClick }: { "aria-label"?: string; onClick?: () => void }) =>
    createElement("button", { "aria-label": label, onClick, type: "button" }),
}));

import { PushReminder } from "@/frontend/components/push-reminder";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("PushReminder permission prompt", () => {
  let root: Root;
  let container: HTMLDivElement;

  function page(html: string) {
    const area = document.createElement("div");
    area.innerHTML = html;
    area.addEventListener("click", (event) => event.preventDefault());
    document.body.append(area);
    return area.firstElementChild as HTMLElement;
  }

  async function mount() {
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(PushReminder));
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
    controller.enable.mockClear();
    controller.status = "off";
    document.body.innerHTML = "";
    container = document.createElement("div");
    document.body.append(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("asks on the first cabinet link and only once", async () => {
    await mount();
    const link = page('<a href="/tariffs"><span>Тарифы</span></a>');

    link.querySelector("span")?.click();
    link.click();

    expect(controller.enable).toHaveBeenCalledOnce();
  });

  it.each([
    ['<button type="button">Перейти к оплате</button>'],
    ['<a href="https://pay.example/">Шлюз</a>'],
    ['<a href="/tariffs" target="_blank">Новое окно</a>'],
    ['<a href="//pay.example/">Другой сайт</a>'],
    ['<div class="push-reminder"><a href="/install">Установить</a></div>'],
  ])("does not ask on %s", async (html) => {
    await mount();
    const element = page(html);

    (element.querySelector("a") ?? element).click();

    expect(controller.enable).not.toHaveBeenCalled();
  });

  it("does not ask once notifications are on or the reminder was hidden", async () => {
    controller.status = "on";
    await mount();
    page('<a href="/tariffs">Тарифы</a>').click();
    expect(controller.enable).not.toHaveBeenCalled();
    await act(async () => root.unmount());

    controller.status = "off";
    window.localStorage.setItem("clean-pay:push-reminder-dismissed-at", String(Date.now()));
    await mount();
    page('<a href="/tariffs">Тарифы</a>').click();
    expect(controller.enable).not.toHaveBeenCalled();
  });

  it("stays quiet for a week after asking, across visits", async () => {
    window.localStorage.setItem(
      "clean-pay:push-prompt-asked-at",
      String(Date.now() - 6 * 24 * 60 * 60 * 1000),
    );
    await mount();

    page('<a href="/extend">Продлить</a>').click();

    expect(controller.enable).not.toHaveBeenCalled();
  });

  it("hides the hint for a week after a refusal and then shows it", async () => {
    controller.status = "denied";
    window.localStorage.setItem(
      "clean-pay:push-prompt-asked-at",
      String(Date.now() - 6 * 24 * 60 * 60 * 1000),
    );
    await mount();
    expect(document.querySelector(".push-reminder")).toBeNull();
    await act(async () => root.unmount());

    window.localStorage.setItem(
      "clean-pay:push-prompt-asked-at",
      String(Date.now() - 8 * 24 * 60 * 60 * 1000),
    );
    await mount();
    expect(document.querySelector(".push-reminder")).not.toBeNull();
  });

  it("asks again after a week without an answer", async () => {
    window.localStorage.setItem(
      "clean-pay:push-prompt-asked-at",
      String(Date.now() - 8 * 24 * 60 * 60 * 1000),
    );
    await mount();

    page('<a href="/extend">Продлить</a>').click();

    expect(controller.enable).toHaveBeenCalledOnce();
  });
});
