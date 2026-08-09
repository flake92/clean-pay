export class CabinetCommandError extends Error {
  constructor(public readonly publicMessage: string) {
    super(publicMessage);
    this.name = "CabinetCommandError";
  }
}

export interface CabinetCommands {
  deleteDevice(hwid: string): Promise<void>;
  deleteAllDevices(): Promise<void>;
  reissueSubscription(): Promise<void>;
  activatePromocode(code: string): Promise<void>;
  logout(): Promise<void>;
}
