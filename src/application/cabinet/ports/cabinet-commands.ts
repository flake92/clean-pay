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

export interface CabinetCommands {
  deleteDevice(hwid: string): Promise<void>;
  deleteAllDevices(): Promise<void>;
  reissueSubscription(): Promise<void>;
  activatePromocode(code: string): Promise<PromocodeActivation>;
  logout(): Promise<void>;
}
