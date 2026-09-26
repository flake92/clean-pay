import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

import {
  collectChatwootProviderLedgerMismatchEvidence,
  createChatwootProviderLedgerDiagnostic,
  withChatwootProviderCaptureDiagnostic,
  withChatwootProviderLedgerDiagnostic,
} from "./chatwoot-provider-ledger-diagnostic.mjs";
import { createJourneySanitizedErrorEvidence } from "./journey-error-evidence.mjs";
import { JOURNEY_FIXTURE_FILENAMES } from "./journey-fixture-manifest.mjs";
import {
  CHATWOOT_INITIAL_PROVIDER_EFFECTS,
  CHATWOOT_RECREATED_PROVIDER_EFFECTS,
} from "./chatwoot-provider-causal-contract.mjs";

const execute = promisify(execFile);
const primaryMessage = "Chatwoot provider ledger is incomplete or outside its bound.";
const primaryHash = "8606ba19f7ef9a7bb2ee2e2011dbde2eabfc33ad4b25ced5dc477658cd7b50af";
const initialEffects = [
  "challenge_verified", "authorization_code_issued", "token_exchanged", "auth_session_issued",
  "read_profile", "read_profile", "read_profile", "read_referral_program", "read_subscription",
  "read_offers", "read_devices", "read_user_by_uuid", "read_profile", "read_subscription",
  "contact_identity_probed",
];
const recreatedEffects = [...initialEffects, ...initialEffects.slice(0, 12), "contact_identity_probed"];
const initialCausalV2Effects = [
  "challenge_verified", "authorization_code_issued", "token_exchanged", "jwks_read",
  "auth_session_issued", "read_profile", "read_notification_preferences", "read_profile",
  "read_profile", "read_subscription", "contact_identity_probed", "read_profile",
  "read_profile", "read_referral_program", "read_subscription", "read_offers", "read_devices",
  "read_user_by_uuid", "read_profile", "read_subscription", "contact_identity_probed",
];
const endpointContracts = [
  ["remnashop", "GET", "/api/v1/public/plans/public", "read_public_plans"],
  ["remnawave", "GET", "/api/system/metadata", "read_metadata"],
  ["remnashop", "POST", "/api/v1/public/auth/email/start", "probe_contract"],
  ["remnashop", "POST", "/api/v1/public/auth/identify", "probe_contract"],
  ["remnashop", "POST", "/api/v1/public/auth/service-session", "probe_contract"],
  ["remnashop", "POST", "/api/v1/public/auth/notification-preferences", "probe_contract"],
  ["chatwoot", "GET", "/api/v1/widget/contact", "contact_identity_probed"],
  ["turnstile", "POST", "/turnstile/v0/siteverify", "challenge_verified"],
  ["telegram-oidc", "GET", "/auth", "authorization_code_issued"],
  ["telegram-oidc", "POST", "/token", "token_exchanged"],
  ["telegram-oidc", "GET", "/.well-known/jwks.json", "jwks_read"],
  ["remnashop", "POST", "/api/v1/public/auth/telegram", "auth_session_issued"],
  ["remnashop", "GET", "/api/v1/public/auth/me", "read_profile"],
  ["remnashop", "GET", "/api/v1/public/referral/program", "read_referral_program"],
  ["remnashop", "GET", "/api/v1/public/subscription/current", "read_subscription"],
  ["remnashop", "GET", "/api/v1/public/subscription/offers", "read_offers"],
  ["remnashop", "GET", "/api/v1/public/subscription/devices", "read_devices"],
  ["remnashop", "GET", "/api/v1/public/auth/notification-preferences", "read_notification_preferences"],
  ["remnawave", "GET", "/api/users/rw-browser-1", "read_user_by_uuid"],
].map(([service, method, pathname, effect]) => ({ service, method, pathname, effect }));

test("binds Chatwoot diagnostic runtime and regression bytes into the fixture manifest", () => {
  const required = ["chatwoot-provider-ledger-diagnostic.contract.spec.ts", "chatwoot-provider-ledger-diagnostic.mjs"];
  expect(JOURNEY_FIXTURE_FILENAMES.filter((entry) => required.includes(entry))).toEqual(required);
  expect(new Set(JOURNEY_FIXTURE_FILENAMES).size).toBe(JOURNEY_FIXTURE_FILENAMES.length);
});

test("retains actual counts around the unchanged 15 and 28 event boundaries", () => {
  for (const phase of ["gap", "stable", "recreated"] as const) {
    const expected = phase === "recreated" ? 28 : 15;
    for (const count of [expected - 1, expected, expected + 1]) {
      const input = options(phase, count);
      const before = JSON.stringify(input);
      expect(createChatwootProviderLedgerDiagnostic(input)).toMatchObject({
        status: "observed", phase, expectedEntryCount: expected, actualEntryCount: count,
        scannedEntryCount: count, scanTruncated: false, entriesAreArray: true,
      });
      expect(JSON.stringify(input)).toBe(before);
    }
  }
  expect(createChatwootProviderLedgerDiagnostic({ ...options(), value: { entries: null } }))
    .toMatchObject({ status: "observed", entriesAreArray: false, actualEntryCount: null });
});

test("publishes versioned initial 21 counts and uncharacterized recreation without an invented expected count", () => {
  const initial = { ...options(), providerCausalContractVersion: 2,
    expectedEffects: initialCausalV2Effects };
  expect(createChatwootProviderLedgerDiagnostic(initial)).toMatchObject({
    schemaVersion: 2, providerCausalContractVersion: 2,
    expectedEntryCount: 21, actualEntryCount: 15, characterization: "initial-causal-v2",
  });
  for (const count of [0, 21, 35, 64, 65, 256]) {
    const input = { ...options("recreated", count), providerCausalContractVersion: 2, expectedEffects: null };
    const diagnostic = createChatwootProviderLedgerDiagnostic(input);
    expect(diagnostic).toMatchObject({
      schemaVersion: 2, providerCausalContractVersion: 2,
      characterization: "uncharacterized-recreated", expectedEntryCount: null,
      actualEntryCount: count, expectedSequenceSha256: null, positionalMismatchCount: null,
      firstMismatches: [], actualSequenceTruncated: count > 64,
    });
    if (!("classCounts" in diagnostic)) throw new Error("Observed diagnostic has no endpoint class counts.");
    expect(diagnostic.classCounts.every((entry) => entry.expected === null
      && entry.missing === null && entry.excess === null)).toBe(true);
    const primary = withChatwootProviderLedgerDiagnostic(new Error("uncharacterized"), input);
    const wrapper = withChatwootProviderCaptureDiagnostic(new Error("wrapped", { cause: primary }), {
      cause: primary, role: "baseline", pairIndex: 1, captureStage: "recreated-snapshot",
    });
    expect(collectChatwootProviderLedgerMismatchEvidence(wrapper)?.entries[0].diagnostic).toEqual(diagnostic);
  }
  expect(createChatwootProviderLedgerDiagnostic({ ...options("recreated"), providerCausalContractVersion: 2 }))
    .toMatchObject({ status: "unavailable" });
});

test("publishes exact current causal v3 counts and readiness endpoint classes", () => {
  for (const phase of ["gap", "stable", "recreated"] as const) {
    const expected = phase === "recreated" ? 42 : 28;
    for (const count of [expected - 1, expected, expected + 1]) {
      const diagnostic = snapshot(createChatwootProviderLedgerDiagnostic(causalOptions(phase, count)));
      expect(diagnostic).toMatchObject({
        schemaVersion: 3,
        providerCausalContractVersion: 3,
        characterization: phase === "recreated" ? "recreated-causal-v3" : "initial-causal-v3",
        status: "observed",
        phase,
        expectedEntryCount: expected,
        actualEntryCount: count,
        scannedEntryCount: count,
        scanTruncated: false,
      });
      expect(diagnostic.classCounts).toEqual(expect.arrayContaining([
        { class: "read_public_plans", expected: 1, actual: count >= 2 ? 1 : 0,
          missing: count >= 2 ? 0 : 1, excess: 0 },
        { class: "read_metadata", expected: 1, actual: count >= 3 ? 1 : 0,
          missing: count >= 3 ? 0 : 1, excess: 0 },
        { class: "probe_contract", expected: 4, actual: count >= 8 ? 4 : Math.max(count - 4, 0),
          missing: count >= 8 ? 0 : Math.max(8 - count, 0), excess: 0 },
      ]));
      expect(Buffer.byteLength(JSON.stringify(diagnostic))).toBeLessThanOrEqual(16 * 1024);
    }
  }
  const bounded = snapshot(createChatwootProviderLedgerDiagnostic(causalOptions("gap", 257)));
  expect(bounded).toMatchObject({
    schemaVersion: 3, expectedEntryCount: 28, actualEntryCount: 257,
    scannedEntryCount: 256, scanTruncated: true, actualSequenceTruncated: true,
  });
  expect(bounded.actualSequence).toHaveLength(64);
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(16 * 1024);

  const privateMarker = "synthetic-v3-provider-secret-must-not-escape";
  let reads = 0;
  const safe = causalOptions();
  Object.defineProperty(safe.value.entries[0], "headers", {
    get: () => { reads += 1; return privateMarker; },
  });
  expect(JSON.stringify(createChatwootProviderLedgerDiagnostic(safe))).not.toContain(privateMarker);
  const getter = causalOptions();
  Object.defineProperty(getter.value.entries[0], "effect", {
    get: () => { reads += 1; return privateMarker; },
  });
  const proxied = causalOptions();
  proxied.value.entries = new Proxy(proxied.value.entries, {
    get: () => { reads += 1; return privateMarker; },
  });
  expect(createChatwootProviderLedgerDiagnostic(getter)).toMatchObject({ status: "unavailable" });
  expect(createChatwootProviderLedgerDiagnostic(proxied)).toMatchObject({ status: "unavailable" });
  expect(reads).toBe(0);
});

test("distinguishes missing and excess endpoint classes from order-only changes", () => {
  const missing = snapshot(createChatwootProviderLedgerDiagnostic(options("gap", 14)));
  expect(missing.classCounts).toEqual(expect.arrayContaining([
    { class: "contact_identity_probed", expected: 1, actual: 0, missing: 1, excess: 0 },
  ]));
  const excess = snapshot(createChatwootProviderLedgerDiagnostic(options("gap", 16)));
  expect(excess.classCounts).toEqual(expect.arrayContaining([
    { class: "read_profile", expected: 4, actual: 5, missing: 0, excess: 1 },
  ]));
  const reordered = options();
  [reordered.value.entries[0], reordered.value.entries[1]] = [reordered.value.entries[1], reordered.value.entries[0]];
  const diagnostic = snapshot(createChatwootProviderLedgerDiagnostic(reordered));
  expect(diagnostic).toMatchObject({ actualEntryCount: 15, positionalMismatchCount: 2 });
  expect(diagnostic.classCounts).toEqual(snapshot(createChatwootProviderLedgerDiagnostic(options())).classCounts);
  expect(diagnostic.actualSequenceSha256).not.toBe(diagnostic.expectedSequenceSha256);
});

test("retains the full enum sequence when histograms and the first eight mismatches hide a late order difference", () => {
  const baseline = options("gap", 21);
  baseline.value.entries = Array.from({ length: 21 }, (_, index) => ({
    ...endpointContracts.find(({ effect }) => effect === (
      index === 19 ? "read_subscription" : index === 20 ? "read_offers" : "read_profile"
    ))!,
  }));
  const candidate = structuredClone(baseline);
  [candidate.value.entries[19], candidate.value.entries[20]] = [candidate.value.entries[20], candidate.value.entries[19]];
  const left = snapshot(createChatwootProviderLedgerDiagnostic(baseline));
  const right = snapshot(createChatwootProviderLedgerDiagnostic(candidate));
  expect(left.classCounts).toEqual(right.classCounts);
  expect(left.firstMismatches).toEqual(right.firstMismatches);
  expect(left.firstMismatches).toHaveLength(8);
  for (const [input, diagnostic] of [[baseline, left], [candidate, right]] as const) {
    const sequence = input.value.entries.map(({ effect }) => effect);
    expect(diagnostic.actualSequence).toEqual(sequence);
    expect(diagnostic.actualSequenceTruncated).toBe(false);
    expect(diagnostic.actualSequenceSha256).toBe(createHash("sha256").update(JSON.stringify(sequence)).digest("hex"));
  }
  expect(left.actualSequence).not.toEqual(right.actualSequence);
  expect(left.actualSequenceSha256).not.toBe(right.actualSequenceSha256);
});

test("bounds published enum sequences independently from the unchanged 256-entry scan and aggregate budget", () => {
  for (const count of [0, 21, 64, 65, 256, 257]) {
    const input = options("gap", count);
    const diagnostic = snapshot(createChatwootProviderLedgerDiagnostic(input));
    expect(diagnostic.actualSequence).toEqual(input.value.entries.slice(0, 64).map(({ effect }) => effect));
    expect(diagnostic.actualSequenceTruncated).toBe(count > 64);
    expect(diagnostic.scannedEntryCount).toBe(Math.min(count, 256));
    expect(diagnostic.actualSequenceSha256).toBe(createHash("sha256")
      .update(JSON.stringify(input.value.entries.slice(0, 256).map(({ effect }) => effect))).digest("hex"));
  }
  const diagnostic = createChatwootProviderLedgerDiagnostic(options("gap", 65));
  expect(Object.isFrozen(Object.getOwnPropertyDescriptor(diagnostic, "actualSequence")?.value)).toBe(true);
  const both = collectChatwootProviderLedgerMismatchEvidence(new AggregateError([
    captured("baseline", 257), captured("candidate", 257),
  ], "two complete bounded role diagnostics"));
  expect(both?.entries).toHaveLength(2);
  expect(both?.truncated).toBe(false);
  expect(Buffer.byteLength(JSON.stringify(both))).toBeLessThanOrEqual(16 * 1024);
});

test("keeps exact read checkpoints and bounds scanned entries, samples and aggregate bytes", () => {
  for (const checkpoint of ["before-snapshot-wait", "first-snapshot-read", "second-snapshot-read"]) {
    expect(createChatwootProviderLedgerDiagnostic({ ...options("gap", 16), checkpoint }))
      .toMatchObject({ checkpoint, actualEntryCount: 16 });
  }
  const large = snapshot(createChatwootProviderLedgerDiagnostic(options("gap", 257)));
  expect(large).toMatchObject({ actualEntryCount: 257, scannedEntryCount: 256, scanTruncated: true });
  expect(large.firstMismatches).toHaveLength(8);
  expect(large.mismatchesTruncated).toBe(true);
  const evidence = collectChatwootProviderLedgerMismatchEvidence(new AggregateError(
    Array.from({ length: 32 }, (_, index) => captured(index % 2 ? "candidate" : "baseline", 257)), "bounded fan-out",
  ));
  expect(evidence?.truncated).toBe(true);
  expect(evidence?.entries.length).toBeLessThanOrEqual(6);
  expect(Buffer.byteLength(JSON.stringify(evidence))).toBeLessThanOrEqual(16 * 1024);
});

test("projects only allowlisted classes and never reads body, headers, query or database fields", () => {
  const privateMarker = "synthetic-private-provider-value-must-not-escape";
  let reads = 0;
  const input = options("gap", 16);
  Object.defineProperty(input.value, "database", { get: () => { reads += 1; return privateMarker; } });
  for (const entry of input.value.entries) {
    for (const field of ["body_contract", "headers", "query_keys", "credential_contract"]) {
      Object.defineProperty(entry, field, { get: () => { reads += 1; return privateMarker; } });
    }
  }
  input.value.entries[0].pathname = `https://example.invalid/${privateMarker}`;
  const diagnostic = snapshot(createChatwootProviderLedgerDiagnostic(input));
  expect(diagnostic).toMatchObject({ status: "observed", actualEntryCount: 16, unknownEndpointCount: 1 });
  expect(diagnostic.actualSequence).toEqual(["unknown-endpoint", ...input.value.entries.slice(1).map(({ effect }) => effect)]);
  expect(JSON.stringify(diagnostic)).not.toContain(privateMarker);
  expect(reads).toBe(0);
  const getter = options();
  Object.defineProperty(getter.value.entries[0], "effect", { get: () => { reads += 1; return privateMarker; } });
  const proxy = new Proxy(options().value, { get: () => { reads += 1; return privateMarker; } });
  for (const unsafe of [getter, { ...options(), value: proxy }]) {
    expect(createChatwootProviderLedgerDiagnostic(unsafe)).toMatchObject({ status: "unavailable" });
  }
  expect(reads).toBe(0);
});

test("rejects forged hash annotations and nested graphs before traversing their contents", () => {
  const sentinel = "9".repeat(64);
  const forged = new Error("foreign annotation");
  Object.defineProperty(forged, Symbol.for("clean-pay.chatwoot-provider-capture-diagnostic.v1"), {
    value: { role: "baseline", pairIndex: 1, captureStage: "gap-snapshot", diagnostic: { reason: sentinel } },
  });
  expect(collectChatwootProviderLedgerMismatchEvidence(forged)).toBeUndefined();
  let reads = 0;
  const nested = Array.from({ length: 256 }, () => Object.defineProperty({}, "secret", {
    get: () => { reads += 1; return sentinel; },
  }));
  const diagnostic = Object.defineProperty({}, Symbol.for("clean-pay.chatwoot-provider-normalized-diagnostic.v1"), {
    value: { status: "observed", phase: "gap", checkpoint: "first-snapshot-read", expected: initialEffects,
      actual: nested, actualEntryCount: 256, entriesAreArray: true },
  });
  const other = new Error("foreign nested annotation");
  Object.defineProperty(other, Symbol.for("clean-pay.chatwoot-provider-capture-diagnostic.v1"), {
    value: { role: "candidate", pairIndex: 1, captureStage: "gap-snapshot", diagnostic },
  });
  expect(collectChatwootProviderLedgerMismatchEvidence(other)).toBeUndefined();
  expect(reads).toBe(0);
  let shared: unknown = "read_profile";
  for (let depth = 0; depth < 3; depth += 1) shared = Array(16).fill(shared);
  const exponential = new Error("foreign shared graph");
  Object.defineProperty(exponential, Symbol.for("clean-pay.chatwoot-provider-capture-diagnostic.v1"), {
    value: { role: "baseline", pairIndex: 1, captureStage: "gap-snapshot", diagnostic: { classCounts: shared } },
  });
  const descriptor = Object.getOwnPropertyDescriptor;
  let descriptorReads = 0;
  let graphEvidence: ReturnType<typeof collectChatwootProviderLedgerMismatchEvidence>;
  try {
    Object.getOwnPropertyDescriptor = (object, key) => {
      descriptorReads += 1;
      if (descriptorReads > 64) throw new Error("Diagnostic work budget exceeded.");
      return descriptor(object, key);
    };
    graphEvidence = collectChatwootProviderLedgerMismatchEvidence(exponential);
  } finally { Object.getOwnPropertyDescriptor = descriptor; }
  expect(graphEvidence).toBeUndefined();
  expect(descriptorReads).toBeLessThanOrEqual(16);
});

test("retains original error identities and both role diagnostics across aggregate wrappers", () => {
  const primary = new Error(primaryMessage);
  expect(withChatwootProviderLedgerDiagnostic(primary, options("gap", 14))).toBe(primary);
  expect(createJourneySanitizedErrorEvidence(primary).messageSha256).toBe(primaryHash);
  expect(withChatwootProviderLedgerDiagnostic(Object.freeze(primary), options())).toBe(primary);
  let reads = 0;
  const poisoned = Object.defineProperty({}, "cause", { get: () => { reads += 1; throw new Error("poison"); } });
  expect(withChatwootProviderCaptureDiagnostic(primary, poisoned)).toBe(primary);
  expect(reads).toBe(0);
  const error = new AggregateError([captured("baseline", 14), captured("candidate", 16)], "outer");
  const before = createJourneySanitizedErrorEvidence(error);
  const evidence = collectChatwootProviderLedgerMismatchEvidence(error);
  expect(evidence).toMatchObject({ entries: [
    { role: "baseline", diagnostic: { expectedEntryCount: 15, actualEntryCount: 14 } },
    { role: "candidate", diagnostic: { expectedEntryCount: 15, actualEntryCount: 16 } },
  ], truncated: false });
  expect(createJourneySanitizedErrorEvidence(error)).toEqual(before);
  expect(evidence?.entries).toMatchObject([options("gap", 14), options("gap", 16)]
    .map(({ value }) => ({ diagnostic: { actualSequence: value.entries.map(({ effect }) => effect) } })));
});

test("publishes actual TS-loader oracle annotations through the real MJS failure CLI without Docker", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const root = await mkdtemp(path.join(tmpdir(), "clean-pay-chatwoot-diagnostic-loader-"));
  const planPath = path.join(root, "invalid-for-live-plan.json");
  await writeFile(planPath, "{}\n", { mode: 0o600, flag: "wx" });
  const script = `
    import { createRequire, registerHooks } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import path from 'node:path';
    import * as diagnostic from './tests/browser/journeys/chatwoot-provider-ledger-diagnostic.mjs';
    const root=process.cwd(); const require=createRequire(path.join(root,'package.json'));
    // Production imports the native orchestrator graph before invoking its TS loader.
    // A separate URL leaves the canonical orchestrator available for the no-Docker throw adapter.
    await import(pathToFileURL(path.join(root,'tests/browser/journeys/chatwoot-phase-proof-orchestrator.mjs')).href+'?diagnostic-native-preload');
    const transform=require(path.join(root,'node_modules/playwright/lib/common/index.js')).transform;
    transform.setSingleTSConfig(path.join(root,'tsconfig.json'));
    const capture=await transform.requireOrImport(path.join(root,'tests/browser/journeys/chatwoot-phase-browser-capture.ts'));
    const diagnosticOptions=${JSON.stringify([causalOptions('gap', 27), causalOptions('gap', 26)])};
    const values=diagnosticOptions.map(({value})=>value);
    const errors=values.map((value,index)=>{
      let primary; try {capture.assertChatwootPhaseProviderLedger(value,'gap');} catch(error){primary=error;}
      if(!primary || primary.message!==${JSON.stringify(primaryMessage)}) throw new Error('Real cardinality oracle did not reject');
      diagnostic.withChatwootProviderLedgerDiagnostic(primary,diagnosticOptions[index]);
      const wrapped=new Error('Chatwoot browser capture failed during gap-snapshot.',{cause:primary});
      return diagnostic.withChatwootProviderCaptureDiagnostic(wrapped,{cause:primary,role:index?'candidate':'baseline',pairIndex:1,captureStage:'gap-snapshot'});
    });
    globalThis.__chatwootDiagnosticTestError=new AggregateError(errors,'Chatwoot dual browser capture did not settle successfully for both roles.');
    const target=pathToFileURL(path.join(root,'tests/browser/journeys/chatwoot-phase-proof-orchestrator.mjs')).href;
    registerHooks({load(url,context,next){
      if(url===target)return {format:'module',shortCircuit:true,source:'export async function orchestrateChatwootPhaseProof(){throw globalThis.__chatwootDiagnosticTestError;}'};
      return next(url,context);
    }});
    const cli=path.join(root,'tests/browser/journeys/prove-chatwoot-phase-stability.mjs');
    process.argv=[process.execPath,cli,'--plan',${JSON.stringify(planPath)},'--output',${JSON.stringify(path.join(root, 'never-published-output'))}];
    await import(pathToFileURL(cli).href);
  `;
  try {
    let failure: { code?: number | string; stdout?: string; stderr?: string } | undefined;
    try {
      await execute(process.execPath, ["--input-type=module", "--eval", script], {
        cwd: repositoryRoot, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024,
        env: { NODE_ENV: "test", ...Object.fromEntries(Object.entries(process.env).filter(([key]) => (
          ["PATH", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE"].includes(key)
        ))) },
      });
    } catch (error) { failure = error as typeof failure; }
    expect(failure?.code).toBe(1);
    expect(failure?.stdout).toBe("");
    expect(failure?.stderr?.trim().split(/\r?\n/)).toHaveLength(1);
    const record = JSON.parse(failure?.stderr ?? "null");
    expect(record).toMatchObject({
      status: "dual_image_chatwoot_phase_stability_failed", errorClass: "AggregateError",
      messageSha256: "838d7bc290315df9b2f9b2bac376fedcbc9d910cf8f9e9a8f77281d811ee2dda",
      causeEvidenceTruncated: false,
      providerLedgerMismatchEvidence: { entries: [
        { role: "baseline", diagnostic: { expectedEntryCount: 28, actualEntryCount: 27, checkpoint: "first-snapshot-read", providerCausalContractVersion: 3 } },
        { role: "candidate", diagnostic: { expectedEntryCount: 28, actualEntryCount: 26, checkpoint: "first-snapshot-read", providerCausalContractVersion: 3 } },
      ], truncated: false },
    });
    expect(record.causeEvidence.filter((entry: { messageSha256: string }) => entry.messageSha256 === primaryHash)).toHaveLength(2);
    expect(record.providerLedgerMismatchEvidence.entries.map((entry: { diagnostic: { actualSequence: string[] } }) => entry.diagnostic.actualSequence))
      .toEqual([causalOptions("gap", 27), causalOptions("gap", 26)]
        .map(({ value }) => value.entries.map(({ effect }) => effect)));
    expect(failure?.stderr).not.toContain(repositoryRoot);
    expect(failure?.stderr).not.toContain("/api/");
  } finally { await unlink(planPath); await rmdir(root); }
});

function options(phase: "gap" | "stable" | "recreated" = "gap", count?: number) {
  const expectedEffects = phase === "recreated" ? recreatedEffects : initialEffects;
  const actual = [...expectedEffects].slice(0, count ?? expectedEffects.length);
  while (actual.length < (count ?? expectedEffects.length)) actual.push("read_profile");
  return { phase, checkpoint: "first-snapshot-read", expectedEffects, endpointContracts,
    value: { database: null, entries: actual.map((effect) => ({ ...endpointContracts.find((entry) => entry.effect === effect)! })) } };
}
function causalOptions(phase: "gap" | "stable" | "recreated" = "gap", count?: number) {
  const expectedEffects = [...(phase === "recreated"
    ? CHATWOOT_RECREATED_PROVIDER_EFFECTS
    : CHATWOOT_INITIAL_PROVIDER_EFFECTS)];
  const actual = expectedEffects.slice(0, count ?? expectedEffects.length);
  while (actual.length < (count ?? expectedEffects.length)) actual.push("read_profile");
  return {
    phase,
    checkpoint: "first-snapshot-read",
    expectedEffects,
    endpointContracts,
    providerCausalContractVersion: 3,
    value: {
      database: null,
      entries: actual.map((effect) => ({
        ...endpointContracts.find((entry) => entry.effect === effect)!,
      })),
    },
  };
}
function captured(role: "baseline" | "candidate", count: number) {
  const cause = withChatwootProviderLedgerDiagnostic(new Error(primaryMessage), options("gap", count));
  const error = new Error("Chatwoot browser capture failed during gap-snapshot.", { cause });
  return withChatwootProviderCaptureDiagnostic(error, { cause, role, pairIndex: 1, captureStage: "gap-snapshot" });
}
function snapshot(value: unknown): Record<string, unknown> { return JSON.parse(JSON.stringify(value)); }
