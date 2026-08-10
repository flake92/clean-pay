export type CabinetCommandResult =
  | { status: "success"; message: string }
  | { status: "error"; message: string };
