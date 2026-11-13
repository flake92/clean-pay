export class CabinetCommandError extends Error {
  constructor(public readonly publicMessage: string) {
    super(publicMessage);
    this.name = "CabinetCommandError";
  }
}

/** What a redeemed code turned out to be; a gift never names its buyer. */
export type PromocodeActivation = {
  isGift: boolean;
};

export type { PromocodePreview } from "@/shared/domain/plan-change";

export interface CabinetCommands {
  deleteDevice(hwid: string): Promise<void>;
  deleteAllDevices(): Promise<void>;
  reissueSubscription(): Promise<void>;
  activatePromocode(code: string): Promise<PromocodeActivation>;
  /** Validate without redeeming; null when the shop cannot preview (older Remnashop). */
  previewPromocode(code: string): Promise<import("@/shared/domain/plan-change").PromocodePreview | null>;
  logout(): Promise<void>;
}
