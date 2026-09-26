/** @vitest-environment jsdom */

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("primereact/button", () => ({
  Button: ({ label, ...props }: Record<string, unknown>) => {
    delete props.icon;
    delete props.outlined;
    return createElement("button", props, String(label));
  },
}));
vi.mock("primereact/inputtext", () => ({
  InputText: (props: Record<string, unknown>) => createElement("input", props),
}));
vi.mock("primereact/message", () => ({
  Message: ({ text }: { text: string }) => createElement("div", { role: "alert" }, text),
}));
vi.mock("primereact/tag", () => ({
  Tag: ({ value }: { value: string }) => createElement("span", null, value),
}));
vi.mock("@/frontend/components/prime/link-button", () => ({
  LinkButton: ({ href, label }: { href: string; label: string }) => createElement("a", { href }, label),
}));

import type { ReferralProgram } from "@/application/models/referral";
import {
  ReferralProgramPanel,
  referralAccrualDescription,
  referralRewardDescription,
} from "@/frontend/components/referral-program-panel";

const baseProgram: ReferralProgram = {
  enabled: true,
  referralCode: "Friend42",
  webReferralUrl: "https://pay.example.com/invite/Friend42",
  invitedCount: 5,
  invitedWithPaymentCount: 3,
  pointsBalance: 75,
  totalPointsIssued: 100,
  totalDaysIssued: 0,
  rewardType: "POINTS",
  rewardStrategy: "AMOUNT",
  accrualStrategy: "ON_FIRST_PAYMENT",
  maxLevel: 1,
  rewardLevels: [{ level: 1, value: 25 }],
};

describe("referral program panel", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => cleanup());

  it("shows the canonical link, payment stats, points balance and exact condition", async () => {
    render(createElement(ReferralProgramPanel, {
      model: { status: "ready", program: baseProgram },
    }));

    expect(screen.getByLabelText("Реферальная ссылка").getAttribute("value"))
      .toBe(baseProgram.webReferralUrl);
    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("75")).toBeTruthy();
    expect(screen.getByText(/после первого успешного платежа/i)).toBeTruthy();
    expect(screen.getByText(/25 баллов/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Скопировать" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(baseProgram.webReferralUrl));
  });

  it("falls back to copy when native sharing is unavailable", async () => {
    render(createElement(ReferralProgramPanel, {
      model: { status: "ready", program: baseProgram },
    }));

    fireEvent.click(screen.getByRole("button", { name: "Поделиться" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(baseProgram.webReferralUrl));
    expect(screen.getByText(/ссылка скопирована/i)).toBeTruthy();
  });

  it("renders mixed historical rewards independently from the current EXTRA_DAYS type", () => {
    const daysProgram: ReferralProgram = {
      ...baseProgram,
      pointsBalance: 7,
      totalPointsIssued: 40,
      totalDaysIssued: 12,
      rewardType: "EXTRA_DAYS",
      rewardStrategy: "PERCENT",
      accrualStrategy: "ON_EACH_PAYMENT",
      rewardLevels: [{ level: 1, value: 10 }],
    };

    expect(referralAccrualDescription(daysProgram)).toContain("каждого успешного платежа");
    expect(referralRewardDescription(daysProgram, daysProgram.rewardLevels[0]!))
      .toContain("10% от оплаченного срока");

    render(createElement(ReferralProgramPanel, {
      model: { status: "ready", program: daysProgram },
    }));
    expect(screen.getByText("Баланс баллов")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("Начислено баллов за всё время")).toBeTruthy();
    expect(screen.getByText("40")).toBeTruthy();
    expect(screen.getByText("Начислено доп. дней за всё время")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText(/Награда: дни/i)).toBeTruthy();
  });
});
