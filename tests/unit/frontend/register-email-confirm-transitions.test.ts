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

function normalizedRegisterEmailConfirmJsx() {
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

  // The TypeScript printer re-emits the JSX from its AST, so the text does not
  // depend on source formatting; the inline snapshot shows exactly what changed.
  return jsx.join("\n\n").replace(/\r\n/g, "\n");
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
      "Завершите проверку Cloudflare Turnstile в блоке ниже и повторите действие.",
    );
    expect(missingRegisterEmailTurnstileTokenMessage(null)).toBe(
      "Cloudflare Turnstile временно недоступен. Обновите страницу или попробуйте позже.",
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
    expect(normalizedRegisterEmailConfirmJsx()).toMatchInlineSnapshot(`
      "<div className="flex flex-column gap-3">
            {verificationDeliveryFailed ? (<Message severity="warn" text="Аккаунт создан, но письмо с кодом не удалось отправить автоматически. Нажмите «Отправить код повторно»."/>) : null}
            {turnstileEnabled ? (<TurnstileWidget action="email_verification" onReady={setTurnstile} onToken={setTurnstileToken} siteKey={turnstileSiteKey}/>) : null}
            <form className="flex flex-column gap-3" onSubmit={onSubmit}>
              <label className="flex flex-column gap-2">
                <span className="text-sm font-medium text-700">Код подтверждения</span>
                <InputText inputMode="numeric" maxLength={6} minLength={6} name="code" pattern="[0-9]{6}" placeholder="000000" required/>
              </label>
              {error ? <Message severity="error" text={error}/> : null}
              {message ? <Message severity="success" text={message}/> : null}
              <div className="flex flex-column gap-2 sm:flex-row">
                <Button className="flex-1" disabled={loading !== null} label="Подтвердить e-mail" loading={loading === "confirm"} type="submit"/>
                <Button className="flex-1" disabled={loading !== null} label="Отправить код повторно" loading={loading === "resend"} onClick={resendCode} outlined type="button"/>
                <Button className="flex-1" disabled={loading !== null} label="Назад" loading={loading === "back"} onClick={goBackToRegister} outlined severity="secondary" type="button"/>
              </div>
            </form>
          </div>"
    `);
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
