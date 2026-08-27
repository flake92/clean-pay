import { afterEach, beforeEach, vi } from "vitest";

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

(globalThis as ReactActGlobal).IS_REACT_ACT_ENVIRONMENT = true;

let unexpectedConsole: Array<{ level: "error" | "warn"; firstArgument: unknown }> = [];
let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;
let consoleWarnSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  unexpectedConsole = [];
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...arguments_) => {
    unexpectedConsole.push({ level: "error", firstArgument: arguments_[0] });
  });
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation((...arguments_) => {
    unexpectedConsole.push({ level: "warn", firstArgument: arguments_[0] });
  });
});

afterEach(() => {
  const observed = unexpectedConsole;
  consoleErrorSpy?.mockRestore();
  consoleWarnSpy?.mockRestore();
  consoleErrorSpy = null;
  consoleWarnSpy = null;
  if (observed.length === 0) return;

  const summary = observed
    .map(({ level, firstArgument }) => `${level}: ${String(firstArgument).slice(0, 500)}`)
    .join("\n");
  throw new Error(`Unexpected browser-test console output:\n${summary}`);
});
