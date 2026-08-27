import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

import {
  beginRegisterEmailConfirmAction,
  createInitialRegisterEmailConfirmState,
  createRegisterEmailConfirmationPayload,
  createRegisterEmailResendPayload,
  finishRegisterEmailConfirmAction,
  hasRegisterEmailTurnstileToken,
  missingRegisterEmailTurnstileTokenMessage,
  registerEmailConfirmReducer,
  registerEmailResendSuccessMessage,
} from "@/frontend/components/register-email-confirm-transitions";

function normalizedRegisterEmailConfirmJsxHash() {
  const path = "src/frontend/components/register-email-confirm-form.tsx";
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
    && node.name?.text === "RegisterEmailConfirmForm"
  );
  if (!component) throw new Error("RegisterEmailConfirmForm is missing");

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

describe("register e-mail confirmation transitions", () => {
  it("creates the exact initial state and applies feedback/Turnstile events", () => {
    const reset = vi.fn();
    const initial = createInitialRegisterEmailConfirmState();
    expect(initial).toEqual({
      loading: null,
      error: null,
      message: null,
      turnstileToken: null,
      turnstile: null,
    });

    const populated = [
      { type: "loading-changed" as const, loading: "confirm" as const },
      { type: "error-changed" as const, error: "Ошибка" },
      { type: "message-changed" as const, message: "Сообщение" },
      { type: "turnstile-token-changed" as const, token: "token" },
      { type: "turnstile-changed" as const, turnstile: { reset } },
    ].reduce(registerEmailConfirmReducer, initial);
    expect(populated).toEqual({
      loading: "confirm",
      error: "Ошибка",
      message: "Сообщение",
      turnstileToken: "token",
      turnstile: { reset },
    });
    expect(registerEmailConfirmReducer(populated, {
      type: "feedback-cleared",
    })).toEqual({
      ...populated,
      error: null,
      message: null,
    });
  });

  it("keeps the same-tick pending-action fencing transitions exact", () => {
    expect(beginRegisterEmailConfirmAction(null, "resend")).toEqual({
      accepted: true,
      action: "resend",
    });
    expect(beginRegisterEmailConfirmAction("confirm", "back")).toEqual({
      accepted: false,
      action: "confirm",
    });
    expect(finishRegisterEmailConfirmAction("confirm", "confirm")).toBeNull();
    expect(finishRegisterEmailConfirmAction("resend", "confirm")).toBe(
      "resend",
    );
  });

  it("builds confirmation and resend Server Action payloads without empty fields", () => {
    expect(createRegisterEmailConfirmationPayload("123456", null)).toEqual({
      code: "123456",
    });
    expect(createRegisterEmailConfirmationPayload("123456", "challenge")).toEqual({
      code: "123456",
      turnstileToken: "challenge",
    });
    expect(createRegisterEmailResendPayload(null)).toEqual({});
    expect(createRegisterEmailResendPayload("challenge")).toEqual({
      turnstileToken: "challenge",
    });
  });

  it("keeps Turnstile requirements and public resend copy exact", () => {
    expect(hasRegisterEmailTurnstileToken(false, null)).toBe(true);
    expect(hasRegisterEmailTurnstileToken(true, "challenge")).toBe(true);
    expect(hasRegisterEmailTurnstileToken(true, null)).toBe(false);
    expect(missingRegisterEmailTurnstileTokenMessage("site-key")).toBe(
      "Пройдите проверку Cloudflare Turnstile.",
    );
    expect(missingRegisterEmailTurnstileTokenMessage(null)).toBe(
      "Ключ сайта Cloudflare Turnstile не настроен.",
    );
    expect(registerEmailResendSuccessMessage({
      kind: "code-sent",
      targetEmail: "person@example.test",
    })).toBe("Код повторно отправлен на person@example.test.");
    expect(registerEmailResendSuccessMessage({ kind: "already-sent" })).toBe(
      "Код повторно отправлен.",
    );
  });
});

describe("register e-mail confirmation architecture", () => {
  it("keeps the public façade export/props and normalized JSX byte-stable", () => {
    const source = readFileSync(
      "src/frontend/components/register-email-confirm-form.tsx",
      "utf8",
    );
    expect(Array.from(
      source.matchAll(/^export function (\w+)/gm),
      (match) => match[1],
    )).toEqual(["RegisterEmailConfirmForm"]);
    expect(source).not.toMatch(/^export (?:type|interface) /m);
    expect(source).toContain("redirectTo?: string;");
    expect(source).toContain("turnstileEnabled?: boolean;");
    expect(source).toContain("turnstileSiteKey?: string | null;");
    expect(source).toContain("verificationDeliveryFailed?: boolean;");
    expect(normalizedRegisterEmailConfirmJsxHash()).toBe(
      "14A0ED0B5F0C0EB1F9824337A9CBDE1C52AF7A9694E8F3CD98A9C93D04703C63",
    );
  });

  it("keeps the façade side-effect free and uses live composition wiring", () => {
    const facade = readFileSync(
      "src/frontend/components/register-email-confirm-form.tsx",
      "utf8",
    );
    expect(facade).toContain("useRegisterEmailConfirmController({");
    expect(facade).toContain(
      "registerEmailConfirmComposition.resetChatwootSession()",
    );
    expect(facade).toContain(
      "registerEmailConfirmComposition.clearSessionAction()",
    );
    expect(facade).toContain(
      "registerEmailConfirmComposition.passkeySetupPath(redirectTo)",
    );
    expect(facade).not.toMatch(/@\/app\/actions/);
    expect(facade).not.toMatch(
      /@\/frontend\/lib\/(?:browser-navigation|chatwoot)/,
    );
    expect(facade).not.toMatch(/\b(?:window|document|FormData)\b/);
  });

  it("keeps pure transitions free of React, actions and browser state", () => {
    const transitions = readFileSync(
      "src/frontend/components/register-email-confirm-transitions.ts",
      "utf8",
    );
    expect(transitions).not.toMatch(/from ["']react["']/);
    expect(transitions).not.toMatch(/@\/app\/actions/);
    expect(transitions).not.toMatch(
      /\b(?:window|document|navigator|localStorage|sessionStorage|FormData|URLSearchParams)\b/,
    );
  });

  it("keeps Chatwoot reset, session clear and navigation ordered in controller", () => {
    const controller = readFileSync(
      "src/frontend/hooks/use-register-email-confirm-controller.ts",
      "utf8",
    );
    const reset = controller.indexOf("resetSupportSession();");
    const clear = controller.indexOf("await clearSession();");
    const navigate = controller.indexOf(
      "navigateTo(registerEmailBackPath(redirectTo));",
    );

    expect(reset).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(reset);
    expect(navigate).toBeGreaterThan(clear);
  });
});
