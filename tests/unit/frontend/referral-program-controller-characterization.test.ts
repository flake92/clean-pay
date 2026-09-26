/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useReferralProgramController } from "@/frontend/hooks/use-referral-program-controller";

const referralUrl = "https://pay.example.com/invite/Friend42";
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const originalShare = Object.getOwnPropertyDescriptor(navigator, "share");
const originalExecCommand = Object.getOwnPropertyDescriptor(
  document,
  "execCommand",
);

function restoreDescriptor(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

function setClipboard(writeText?: (value: string) => Promise<void>) {
  if (writeText) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  } else {
    Reflect.deleteProperty(navigator, "clipboard");
  }
}

function setShare(
  share?: (data: ShareData) => Promise<void>,
) {
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  });
}

function renderController() {
  return renderHook(() => useReferralProgramController({ referralUrl }));
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function prepareTextareaFallback(execCommandResult: boolean) {
  const order: string[] = [];
  const textarea = document.createElement("textarea");
  const originalCreateElement = document.createElement.bind(document);
  const originalAppend = document.body.append.bind(document.body);
  const originalRemove = textarea.remove.bind(textarea);

  vi.spyOn(document, "createElement").mockImplementation((
    ((tagName: string, options?: ElementCreationOptions) =>
      tagName === "textarea"
        ? textarea
        : originalCreateElement(tagName, options)) as typeof document.createElement
  ));
  vi.spyOn(document.body, "append").mockImplementation((...nodes) => {
    if (nodes.includes(textarea)) order.push("append");
    originalAppend(...nodes);
  });
  vi.spyOn(textarea, "select").mockImplementation(() => {
    order.push("select");
    expect(textarea.isConnected).toBe(true);
  });
  vi.spyOn(textarea, "remove").mockImplementation(() => {
    order.push("remove");
    originalRemove();
  });
  const execCommand = vi.fn(() => {
    order.push("execCommand");
    expect(textarea.isConnected).toBe(true);
    return execCommandResult;
  });
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });

  return { execCommand, order, textarea };
}

describe("referral program browser controller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setClipboard();
    setShare();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    restoreDescriptor(navigator, "clipboard", originalClipboard);
    restoreDescriptor(navigator, "share", originalShare);
    restoreDescriptor(document, "execCommand", originalExecCommand);
    document.querySelectorAll("textarea").forEach((element) => element.remove());
  });

  it("waits for native clipboard completion before reporting success", async () => {
    const write = deferred();
    const writeText = vi.fn(() => write.promise);
    setClipboard(writeText);
    const view = renderController();
    let completion!: Promise<void>;

    act(() => {
      completion = view.result.current.copyLink();
    });
    expect(writeText).toHaveBeenCalledWith(referralUrl);
    expect(view.result.current.feedback).toBeNull();

    await act(async () => {
      write.resolve();
      await completion;
    });
    expect(view.result.current.feedback).toBe("Ссылка скопирована.");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("uses append, select, execCommand and remove in exact fallback order", async () => {
    const { execCommand, order, textarea } = prepareTextareaFallback(true);
    const view = renderController();

    await act(async () => view.result.current.copyLink());

    expect(order).toEqual(["append", "select", "execCommand", "remove"]);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(textarea.value).toBe(referralUrl);
    expect(textarea.style.position).toBe("fixed");
    expect(textarea.style.opacity).toBe("0");
    expect(textarea.isConnected).toBe(false);
    expect(view.result.current.feedback).toBe("Ссылка скопирована.");
  });

  it("removes the fallback textarea before reporting copy failure", async () => {
    const { order, textarea } = prepareTextareaFallback(false);
    const view = renderController();

    await act(async () => view.result.current.copyLink());

    expect(order).toEqual(["append", "select", "execCommand", "remove"]);
    expect(textarea.isConnected).toBe(false);
    expect(view.result.current.feedback).toBe(
      "Не удалось скопировать ссылку. Выделите её вручную.",
    );
  });

  it("does not fall back when an available native clipboard rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const createElement = vi.spyOn(document, "createElement");
    setClipboard(writeText);
    const view = renderController();

    await act(async () => view.result.current.copyLink());

    expect(writeText).toHaveBeenCalledOnce();
    expect(createElement.mock.calls.some(([tagName]) => tagName === "textarea"))
      .toBe(false);
    expect(view.result.current.feedback).toBe(
      "Не удалось скопировать ссылку. Выделите её вручную.",
    );
  });

  it("passes the exact native share payload and waits before feedback", async () => {
    const sharing = deferred();
    const share = vi.fn(() => sharing.promise);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    setShare(share);
    const view = renderController();
    let completion!: Promise<void>;

    act(() => {
      completion = view.result.current.shareLink();
    });
    expect(share).toHaveBeenCalledWith({
      title: "Приглашение",
      text: "Присоединяйтесь по моей ссылке",
      url: referralUrl,
    });
    expect(writeText).not.toHaveBeenCalled();
    expect(view.result.current.feedback).toBeNull();

    await act(async () => {
      sharing.resolve();
      await completion;
    });
    expect(view.result.current.feedback).toBe("Ссылка отправлена.");
  });

  it("copies only after determining that native sharing is unavailable", async () => {
    const order: string[] = [];
    const writeText = vi.fn(async () => {
      order.push("clipboard");
    });
    setClipboard(writeText);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      get() {
        order.push("share-check");
        return undefined;
      },
    });
    const view = renderController();

    await act(async () => view.result.current.shareLink());

    expect(order).toEqual(["share-check", "clipboard"]);
    expect(writeText).toHaveBeenCalledWith(referralUrl);
    expect(view.result.current.feedback).toBe(
      "Функция отправки недоступна — ссылка скопирована.",
    );
  });

  it("keeps prior feedback on cancellation and reports other share errors", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const view = renderController();
    await act(async () => view.result.current.copyLink());
    expect(view.result.current.feedback).toBe("Ссылка скопирована.");

    setShare(vi.fn().mockRejectedValue(
      new DOMException("cancelled", "AbortError"),
    ));
    await act(async () => view.result.current.shareLink());
    expect(view.result.current.feedback).toBe("Ссылка скопирована.");

    setShare(vi.fn().mockRejectedValue(new Error("share failed")));
    await act(async () => view.result.current.shareLink());
    expect(view.result.current.feedback).toBe(
      "Не удалось отправить ссылку.",
    );
  });

  it("keeps duplicate same-tick share attempts unfenced", async () => {
    const first = deferred();
    const second = deferred();
    const share = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    setShare(share);
    const view = renderController();
    let firstCompletion!: Promise<void>;
    let secondCompletion!: Promise<void>;

    act(() => {
      firstCompletion = view.result.current.shareLink();
      secondCompletion = view.result.current.shareLink();
    });
    expect(share).toHaveBeenCalledTimes(2);

    await act(async () => {
      first.resolve();
      second.resolve();
      await Promise.all([firstCompletion, secondCompletion]);
    });
    expect(view.result.current.feedback).toBe("Ссылка отправлена.");
  });
});
