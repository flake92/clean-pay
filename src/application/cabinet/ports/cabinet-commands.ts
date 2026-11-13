export class CabinetCommandError extends Error {
  constructor(public readonly publicMessage: string) {
    super(publicMessage);
    this.name = "CabinetCommandError";
  }
}

/** What a redeemed code turned out to be; `giftedBy` is null for an anonymous gift. */
export type PromocodeActivation = {
  isGift: boolean;
  giftedBy: string | null;
};

export interface CabinetCommands {
  deleteDevice(hwid: string): Promise<void>;
  deleteAllDevices(): Promise<void>;
  reissueSubscription(): Promise<void>;
  activatePromocode(code: string): Promise<PromocodeActivation>;
  logout(): Promise<void>;
}
