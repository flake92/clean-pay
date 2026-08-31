import { describe, expect, it } from "vitest";

import {
  createTurnstileWidgetState,
  turnstileWidgetReducer,
} from "@/frontend/lib/turnstile-transitions";

describe("Turnstile widget transitions", () => {
  it("preserves the exact initial loading decision", () => {
    expect(createTurnstileWidgetState(undefined)).toEqual({
      error: null,
      loading: false,
    });
    expect(createTurnstileWidgetState("")).toEqual({
      error: null,
      loading: false,
    });
    expect(createTurnstileWidgetState(" ")).toEqual({
      error: null,
      loading: true,
    });
  });

  it("preserves independent loading and callback error transitions", () => {
    const loading = createTurnstileWidgetState("site-key");
    const challengeFailure = turnstileWidgetReducer(loading, {
      type: "challenge-failed",
    });
    expect(challengeFailure).toEqual({
      error: "Не удалось пройти проверку Cloudflare Turnstile.",
      loading: true,
    });
    expect(turnstileWidgetReducer(challengeFailure, {
      type: "script-loaded",
    })).toEqual({
      error: "Не удалось пройти проверку Cloudflare Turnstile.",
      loading: false,
    });
    expect(turnstileWidgetReducer(challengeFailure, {
      type: "challenge-accepted",
    })).toEqual({
      error: null,
      loading: true,
    });
    expect(turnstileWidgetReducer(loading, {
      type: "script-load-failed",
    })).toEqual({
      error: "Не удалось загрузить Cloudflare Turnstile.",
      loading: false,
    });
  });
});
