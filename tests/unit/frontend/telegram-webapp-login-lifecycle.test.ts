/** @vitest-environment jsdom */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { act } from "react";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import ts from "typescript";
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  useTelegramWebAppLoginController,
  type TelegramWebAppLoginControllerDependencies,
} from "@/frontend/hooks/use-telegram-webapp-login-controller";

function normalizedTelegramLoginJsxHash() {
  const path = "src/frontend/components/telegram-webapp-login.tsx";
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const component = sourceFile.statements.find((node) =>
    ts.isFunctionDeclaration(node)
    && node.name?.text === "TelegramWebAppLogin"
  );
  if (!component) throw new Error("TelegramWebAppLogin is missing");

  const printer = ts.createPrinter({
    removeComments: true,
    newLine: ts.NewLineKind.LineFeed,
  });
  const jsx: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isReturnStatement(node) && node.expression) {
      let expression = node.expression;
      while (ts.isParenthesizedExpression(expression)) {
        expression = expression.expression;
      }
      if (
        ts.isJsxElement(expression)
        || ts.isJsxFragment(expression)
        || ts.isJsxSelfClosingElement(expression)
      ) {
        jsx.push(printer.printNode(
          ts.EmitHint.Unspecified,
          expression,
          sourceFile,
        ));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(component);
  const normalized = jsx.join("\n").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").toUpperCase();
}

function controllerDependencies({
  authenticate = vi.fn(async () => ({ ok: true as const })),
  events = [] as string[],
  getTelegramWebApp = vi.fn(() => ({
    expand: () => events.push("expand"),
    initData: " signed-init-data ",
    ready: () => events.push("ready"),
  })),
  loadScript = vi.fn(async () => undefined),
  markSession = vi.fn(() => events.push("mark-session")),
  origin = "https://pay.example",
  replaceLocation = vi.fn((destination: string) =>
    events.push(`replace:${destination}`)
  ),
}: {
  authenticate?: Mock<(initData: string) => unknown>;
  events?: string[];
  getTelegramWebApp?: Mock<() => unknown>;
  loadScript?: Mock<() => unknown>;
  markSession?: Mock<() => unknown>;
  origin?: string;
  replaceLocation?: Mock<(destination: string) => unknown>;
} = {}) {
  const dependencies = {
    authenticateTelegramWebAppAction: async (initData: string) => {
      events.push(`authenticate:${initData}`);
      return authenticate(initData);
    },
    getLocationOrigin: () => origin,
    getTelegramWebApp: () => {
      events.push("get-webapp");
      return getTelegramWebApp();
    },
    loadTelegramWebAppScript: async () => {
      events.push("load-script");
      return loadScript();
    },
    markTelegramWebAppSession: markSession,
    replaceLocation,
  } as unknown as TelegramWebAppLoginControllerDependencies;

  return {
    authenticate,
    dependencies,
    events,
    getTelegramWebApp,
    loadScript,
    markSession,
    replaceLocation,
  };
}

describe("Telegram WebApp login lifecycle", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("authenticates once with normalized initData and preserves full order", async () => {
    const fixture = controllerDependencies();
    renderHook(() => useTelegramWebAppLoginController({
      dependencies: fixture.dependencies,
      redirectTo: "/cabinet?tab=devices#active",
    }));

    await waitFor(() => expect(fixture.replaceLocation).toHaveBeenCalledOnce());

    expect(fixture.authenticate).toHaveBeenCalledOnce();
    expect(fixture.authenticate).toHaveBeenCalledWith("signed-init-data");
    expect(fixture.events).toEqual([
      "load-script",
      "get-webapp",
      "ready",
      "expand",
      "mark-session",
      "authenticate:signed-init-data",
      "replace:/cabinet?tab=devices#active",
    ]);
  });

  it("starts fallback only after script readiness and uses the exact encoded URL", async () => {
    const events: string[] = [];
    const fixture = controllerDependencies({
      events,
      getTelegramWebApp: vi.fn(() => ({
        expand: () => events.push("expand"),
        initData: "   ",
        ready: () => events.push("ready"),
      })),
    });
    const hook = renderHook(() => useTelegramWebAppLoginController({
      dependencies: fixture.dependencies,
      redirectTo: "/payment?plan=pro&duration=30#checkout",
    }));

    await waitFor(() => expect(fixture.replaceLocation).toHaveBeenCalledOnce());

    expect(hook.result.current).toEqual({
      error: null,
      fallbackStarted: true,
    });
    expect(fixture.authenticate).not.toHaveBeenCalled();
    expect(fixture.markSession).not.toHaveBeenCalled();
    expect(fixture.replaceLocation).toHaveBeenCalledWith(
      "https://pay.example/auth/telegram/start?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%23checkout",
    );
    expect(events).toEqual([
      "load-script",
      "get-webapp",
      "ready",
      "expand",
      "replace:https://pay.example/auth/telegram/start?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30%23checkout",
    ]);
  });

  it("keeps the loader timeout pending through 5000ms and surfaces it at 5050ms", async () => {
    vi.useFakeTimers();
    const loadScript = vi.fn(() => new Promise<void>((_resolve, reject) => {
      window.setTimeout(() => reject(
        new Error("Telegram WebApp API is unavailable"),
      ), 5050);
    }));
    const fixture = controllerDependencies({ loadScript });
    const hook = renderHook(() => useTelegramWebAppLoginController({
      dependencies: fixture.dependencies,
      redirectTo: "/cabinet",
    }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(hook.result.current.error).toBeNull();
    expect(fixture.getTelegramWebApp).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(hook.result.current.error).toBe(
      "Telegram WebApp API is unavailable",
    );
    expect(fixture.authenticate).not.toHaveBeenCalled();
    expect(fixture.replaceLocation).not.toHaveBeenCalled();
  });

  it("preserves in-flight work after unmount while suppressing late error state", async () => {
    let resolveLoad!: () => void;
    const loadScript = vi.fn(() => new Promise<void>((resolve) => {
      resolveLoad = resolve;
    }));
    const fixture = controllerDependencies({ loadScript });
    const hook = renderHook(() => useTelegramWebAppLoginController({
      dependencies: fixture.dependencies,
      redirectTo: "/cabinet",
    }));

    hook.unmount();
    await act(async () => resolveLoad());

    expect(fixture.authenticate).toHaveBeenCalledOnce();
    expect(fixture.replaceLocation).toHaveBeenCalledWith("/cabinet");
  });

  it("preserves stale redirect effects and exact duplicate action payloads", async () => {
    let resolveFirst!: () => void;
    let resolveSecond!: () => void;
    const loadScript = vi.fn()
      .mockReturnValueOnce(new Promise<void>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockReturnValueOnce(new Promise<void>((resolve) => {
        resolveSecond = resolve;
      }));
    const fixture = controllerDependencies({ loadScript });
    const hook = renderHook(
      ({ redirectTo }) => useTelegramWebAppLoginController({
        dependencies: fixture.dependencies,
        redirectTo,
      }),
      { initialProps: { redirectTo: "/first" } },
    );
    hook.rerender({ redirectTo: "/second" });

    await act(async () => resolveSecond());
    await waitFor(() => expect(fixture.replaceLocation).toHaveBeenCalledWith(
      "/second",
    ));
    await act(async () => resolveFirst());
    await waitFor(() => expect(fixture.replaceLocation).toHaveBeenCalledWith(
      "/first",
    ));

    expect(fixture.authenticate.mock.calls).toEqual([
      ["signed-init-data"],
      ["signed-init-data"],
    ]);
    expect(fixture.replaceLocation.mock.calls).toEqual([
      ["/second"],
      ["/first"],
    ]);
  });
});

describe("Telegram WebApp login architecture", () => {
  it("keeps the sole export/props and normalized JSX byte-stable", () => {
    const facade = readFileSync(
      "src/frontend/components/telegram-webapp-login.tsx",
      "utf8",
    );
    expect(Array.from(
      facade.matchAll(/^export function (\w+)/gm),
      (match) => match[1],
    )).toEqual(["TelegramWebAppLogin"]);
    expect(facade).not.toMatch(/^export (?:type|interface) /m);
    expect(facade).toContain("redirectTo?: string");
    expect(normalizedTelegramLoginJsxHash()).toBe(
      "96D462CB8F3126B0D12048739F0CFE157E435CCB23E367CB00D796375A673213",
    );
  });

  it("keeps effects/actions out of the view and source contracts in live wiring", () => {
    const facade = readFileSync(
      "src/frontend/components/telegram-webapp-login.tsx",
      "utf8",
    );
    expect(facade).toContain("useTelegramWebAppLoginController({");
    expect(facade).toContain("authenticateTelegramWebAppAction(initData)");
    expect(facade).toContain("window.location.replace(redirectTo)");
    expect(facade).toContain(
      "authenticateTelegramWebAppAction,\n  getLocationOrigin:",
    );
    expect(facade).toContain("replaceLocation,");
    expect(facade).not.toMatch(/@\/app\/actions/);
    expect(facade).not.toMatch(/\b(?:useEffect|useState)\b/);
    expect(facade).toContain(
      "const window = telegramWebAppLoginComposition.window;",
    );
  });

  it("keeps timing in the loader and browser state in the environment boundary", () => {
    const transitions = readFileSync(
      "src/frontend/lib/telegram-webapp-login-transitions.ts",
      "utf8",
    );
    const loader = readFileSync(
      "src/frontend/lib/telegram-webapp-script-loader.ts",
      "utf8",
    );
    const environment = readFileSync(
      "src/frontend/lib/telegram-webapp-environment.ts",
      "utf8",
    );

    expect(transitions).not.toMatch(/from ["']react["']/);
    expect(transitions).not.toMatch(/@\/app\/actions/);
    expect(transitions).not.toMatch(/\b(?:window|document|sessionStorage)\b/);
    expect(loader).toContain("Date.now() - startedAt > 5000");
    expect(loader).toContain("}, 50);");
    expect(loader).toContain("telegramWebAppScriptPromise");
    expect(environment).toContain("window.sessionStorage.setItem");
  });
});
