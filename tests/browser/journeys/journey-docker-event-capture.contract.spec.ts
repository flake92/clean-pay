import { expect, test } from "@playwright/test";
import { EventEmitter } from "node:events";
import path from "node:path";
import { PassThrough } from "node:stream";

import { createJourneyDockerEventCaptureOwner } from "./journey-docker-event-capture.mjs";

const lifecycleBounds = Object.freeze({
  completionTimeoutMs: 20,
  killCloseTimeoutMs: 5,
  shutdownTimeoutMs: 25,
  terminationGraceMs: 5,
});

test("captures split exact records with a project-scoped bounded Docker subscription", async () => {
  const fixture = fakeDockerEventChild({ closeOn: "SIGTERM" });
  let invocation: { args: string[]; command: string; options: Record<string, unknown> } | undefined;
  const owner = createJourneyDockerEventCaptureOwner({
    environment: { PATH: "synthetic" },
    lifecycleBounds,
    lifecycleNotBefore: "2026-01-01T00:00:00.000Z",
    project: "clean-pay-capture-test",
    repositoryRoot: path.resolve("."),
    spawnProcess: (command: string, args: string[], options: Record<string, unknown>) => {
      invocation = { args, command, options };
      return fixture.child;
    },
    verifyProcessTerminated: async () => false,
  });
  const nonce = "1".repeat(32);
  const id = "a".repeat(64);
  const line = `1767225600000000001|create|${id}|journey-event-barrier|${nonce}`;
  fixture.stdout.write(line.slice(0, 37));
  fixture.stdout.write(`${line.slice(37)}\n`);

  await expect(owner.waitForBarrier(nonce)).resolves.toEqual({
    containerId: id,
    timeNano: "1767225600000000001",
  });
  await expect(owner.stop()).resolves.toBe(line);
  expect(owner.terminationProven()).toBe(true);
  expect(invocation?.command).toBe("docker");
  expect(invocation?.args).toContain("label=com.docker.compose.project=clean-pay-capture-test");
  expect(invocation?.args.filter((entry) => entry.startsWith("event=")).sort()).toEqual([
    "event=create", "event=die", "event=restart", "event=start",
  ]);
  expect(invocation?.options).toMatchObject({
    cwd: path.resolve("."),
    env: { PATH: "synthetic" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
});

test("fails closed on malformed, overflowing, diagnostic and errored capture streams", async () => {
  const cases: Array<{
    expected: RegExp;
    mutate: (fixture: ReturnType<typeof fakeDockerEventChild>) => void;
  }> = [
    {
      expected: /invalid or unbound record/,
      mutate: ({ child, stdout }) => {
        stdout.write("malformed-final-record");
        child.exitCode = 0;
        child.emit("close", 0, null);
      },
    },
    {
      expected: /bounded output/,
      mutate: ({ stdout }) => stdout.write("x".repeat(64 * 1024 + 1)),
    },
    {
      expected: /unexpected diagnostics/,
      mutate: ({ stderr }) => stderr.write("€".repeat(2_000)),
    },
    {
      expected: /stdout failed/,
      mutate: ({ stdout }) => stdout.emit("error", new Error("private stream failure")),
    },
  ];
  for (const [index, entry] of cases.entries()) {
    const fixture = fakeDockerEventChild({ closeOn: "SIGTERM", pid: 5_000 + index });
    const owner = captureOwner(fixture);
    entry.mutate(fixture);
    await expect(owner.stop()).rejects.toThrow(entry.expected);
    expect(owner.terminationProven()).toBe(true);
  }
});

test("bounds barrier waits and requires stdio close even after exact PID absence", async () => {
  const fixture = fakeDockerEventChild({ closeOn: undefined });
  let processAbsent = false;
  const owner = captureOwner(fixture, async () => processAbsent);
  await expect(owner.waitForBarrier("2".repeat(32))).rejects.toThrow(/timed out/);
  await expect(owner.stop()).rejects.toThrow(/termination was not proven/);
  expect(owner.terminationProven()).toBe(false);
  processAbsent = true;
  await expect(owner.stop()).rejects.toThrow(/not sealed through stdio close/);
  expect(owner.terminationProven()).toBe(true);
  expect(fixture.kills).toContain("SIGTERM");
  expect(fixture.kills).toContain("SIGKILL");
});

test("accepts escalation only after the killed child emits exact stdio close", async () => {
  const fixture = fakeDockerEventChild({ closeOn: "SIGKILL" });
  const owner = captureOwner(fixture);
  await expect(owner.stop()).resolves.toBe("");
  expect(fixture.kills).toEqual(["SIGTERM", "SIGKILL"]);
  expect(owner.terminationProven()).toBe(true);
});

test("accepts the exact POSIX SIGTERM exit only after its signal request was accepted", async () => {
  const accepted = fakeDockerEventChild({ closeCode: 143, closeOn: "SIGTERM" });
  await expect(captureOwner(accepted).stop()).resolves.toBe("");
  expect(accepted.kills).toEqual(["SIGTERM"]);

  const wrongCode = fakeDockerEventChild({ closeCode: 142, closeOn: "SIGTERM" });
  await expect(captureOwner(wrongCode).stop()).rejects.toThrow(/exact stop contract/);

  const rejectedSignal = fakeDockerEventChild({
    closeCode: 143,
    closeOn: "SIGTERM",
    killAccepted: false,
  });
  await expect(captureOwner(rejectedSignal).stop()).rejects.toThrow(/exact stop contract/);
});

test("binds every accepted close tuple to the exact requested signal sequence", async () => {
  const rejectedNativeSigterm = fakeDockerEventChild({
    closeOn: "SIGTERM",
    killAccepted: false,
  });
  await expect(captureOwner(rejectedNativeSigterm).stop()).rejects.toThrow(/exact stop contract/);

  const spontaneousCleanExit = fakeDockerEventChild({ closeOn: undefined });
  const spontaneousOwner = captureOwner(spontaneousCleanExit);
  spontaneousCleanExit.child.exitCode = 0;
  const spontaneousStop = spontaneousOwner.stop();
  queueMicrotask(() => spontaneousCleanExit.child.emit("close", 0, null));
  await expect(spontaneousStop).rejects.toThrow(/exact stop contract/);

  const rejectedSigkill = fakeDockerEventChild({
    closeOn: "SIGKILL",
    killAccepted: (signal) => signal === "SIGTERM",
  });
  await expect(captureOwner(rejectedSigkill).stop()).rejects.toThrow(/exact stop contract/);
});

test("retains the accepted signal ledger until a delayed stdio close is sealed", async () => {
  const fixture = fakeDockerEventChild({ closeOn: undefined });
  const owner = captureOwner(fixture, async () => true);
  fixture.child.kill = (signal = "SIGTERM") => {
    fixture.kills.push(signal);
    if (signal === "SIGTERM") fixture.child.exitCode = 143;
    return true;
  };

  await expect(owner.stop()).rejects.toThrow(/not sealed through stdio close/);
  expect(fixture.kills).toEqual(["SIGTERM"]);
  fixture.child.signalCode = null;
  fixture.child.emit("close", 143, null);

  await expect(owner.stop()).resolves.toBe("");
  expect(fixture.kills).toEqual(["SIGTERM"]);
});

function captureOwner(
  fixture: ReturnType<typeof fakeDockerEventChild>,
  verifyProcessTerminated: (pid: number) => Promise<boolean> = async () => false,
) {
  return createJourneyDockerEventCaptureOwner({
    environment: {},
    lifecycleBounds,
    lifecycleNotBefore: "2026-01-01T00:00:00.000Z",
    project: "clean-pay-capture-test",
    repositoryRoot: path.resolve("."),
    spawnProcess: () => fixture.child,
    verifyProcessTerminated,
  });
}

function fakeDockerEventChild({
  closeCode,
  closeOn,
  killAccepted = true,
  pid = 4_242,
}: {
  closeCode?: number;
  closeOn: "SIGKILL" | "SIGTERM" | undefined;
  killAccepted?: boolean | ((signal: NodeJS.Signals) => boolean);
  pid?: number;
}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    kill: (signal?: NodeJS.Signals) => boolean;
    pid: number;
    signalCode: NodeJS.Signals | null;
    stderr: PassThrough;
    stdout: PassThrough;
  };
  const kills: NodeJS.Signals[] = [];
  child.exitCode = null;
  child.pid = pid;
  child.signalCode = null;
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = (signal = "SIGTERM") => {
    kills.push(signal);
    if (signal === closeOn) {
      queueMicrotask(() => {
        child.exitCode = closeCode ?? null;
        child.signalCode = closeCode === undefined ? signal : null;
        child.emit("close", child.exitCode, child.signalCode);
      });
    }
    return typeof killAccepted === "function" ? killAccepted(signal) : killAccepted;
  };
  return { child, kills, stderr, stdout };
}
