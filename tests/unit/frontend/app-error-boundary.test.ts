/** @vitest-environment jsdom */

import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AppError from "@/app/error";

describe("application error boundary", () => {
  it("offers a safe retry without exposing the exception message", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("private upstream response"), {
      digest: "incident-123",
    });
    const view = render(createElement(AppError, { error, reset }));

    expect(view.getByRole("alert").textContent).toContain("Код события: incident-123");
    expect(view.getByRole("alert").textContent).not.toContain("private upstream response");
    fireEvent.click(view.getByRole("button", { name: /попробовать снова/i }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
