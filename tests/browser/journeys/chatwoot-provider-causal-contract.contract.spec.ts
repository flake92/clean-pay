import { expect, test } from "@playwright/test";

import {
  assertChatwootProviderCausalLedger,
  CHATWOOT_INITIAL_PROVIDER_EFFECTS,
  projectChatwootProviderCausalEntries,
} from "./chatwoot-provider-causal-contract.mjs";
import { JOURNEY_FIXTURE_FILENAMES } from "./journey-fixture-manifest.mjs";

test("binds the versioned causal runtime and its tests into the fixture", () => {
  expect(JOURNEY_FIXTURE_FILENAMES).toContain("chatwoot-provider-causal-contract.mjs");
  expect(JOURNEY_FIXTURE_FILENAMES).toContain("chatwoot-provider-causal-contract.contract.spec.ts");
});

test("accepts exactly the 60 cabinet read permutations that preserve subscription before user", () => {
  const initial = fixture();
  const original = JSON.stringify(initial);
  const expected = projectChatwootProviderCausalEntries(initial, "gap");
  let accepted = 0;
  let rejected = 0;
  for (const order of permutations([13, 14, 15, 16, 17])) {
    const entries = initial.map((entry, index) => index >= 13 && index <= 17
      ? { ...initial[order[index - 13]], sequence: index + 1 } : entry);
    if (order.indexOf(14) < order.indexOf(17)) {
      const contract = assertChatwootProviderCausalLedger(entries, "gap");
      expect(contract.contractVersion).toBe(2);
      expect(new Set(contract.semanticNodeIds).size).toBe(21);
      expect(projectChatwootProviderCausalEntries(entries, "gap")).toEqual(expected);
      expect(projectChatwootProviderCausalEntries(entries, "stable")).toEqual(expected);
      accepted += 1;
    } else {
      expect(() => assertChatwootProviderCausalLedger(entries, "gap")).toThrow(/versioned causal contract/);
      rejected += 1;
    }
  }
  expect({ accepted, rejected }).toEqual({ accepted: 60, rejected: 60 });
  expect(JSON.stringify(initial)).toBe(original);
});

test("rejects strict auth, profile, contact, duplicate, missing, extra and ordinal changes", () => {
  for (const [left, right] of [[0, 1], [2, 3], [6, 7], [10, 11], [12, 13], [17, 18], [19, 20]]) {
    const entries = fixture();
    [entries[left], entries[right]] = [entries[right], entries[left]];
    const resequenced = entries.map((entry, index) => ({ ...entry, sequence: index + 1 }));
    expect(() => assertChatwootProviderCausalLedger(resequenced, "gap")).toThrow();
  }
  const duplicate = fixture();
  duplicate[15].effect = duplicate[16].effect;
  expect(() => assertChatwootProviderCausalLedger(duplicate, "gap")).toThrow();
  expect(() => assertChatwootProviderCausalLedger(fixture().slice(0, -1), "gap")).toThrow();
  expect(() => assertChatwootProviderCausalLedger([...fixture(), fixture()[20]], "gap")).toThrow();
  const ordinal = fixture();
  ordinal[14].sequence = 999;
  expect(() => assertChatwootProviderCausalLedger(ordinal, "gap")).toThrow();
});

test("retains every full entry field in the additional node projection and leaves raw arrival untouched", () => {
  const entries = fixture();
  const before = JSON.stringify(entries);
  const projected = projectChatwootProviderCausalEntries(entries, "gap");
  expect(projected.nodes).toHaveLength(21);
  for (const [index, node] of projected.nodes.entries()) {
    const { sequence: arrivalSequence, ...fullValue } = entries[index];
    expect(arrivalSequence).toBe(index + 1);
    expect(node.value).toEqual(fullValue);
    expect(Object.keys(node.value).sort()).toEqual(Object.keys(fullValue).sort());
    expect(node.value).not.toHaveProperty("sequence");
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.value.credential_contract)).toBe(true);
  }
  expect(projected.edges).toContainEqual(["cabinet.subscription", "cabinet.subscription-user"]);
  expect(Object.isFrozen(projected)).toBe(true);
  expect(Object.isFrozen(projected.nodes)).toBe(true);
  expect(JSON.stringify(entries)).toBe(before);
  const changed = fixture();
  changed[15].credential_contract.headers.push("changed-credential");
  expect(projectChatwootProviderCausalEntries(changed, "gap")).not.toEqual(projected);
  changed[15].body_sha256 = "f".repeat(64);
  expect(projectChatwootProviderCausalEntries(changed, "gap")).not.toEqual(projected);
});

test("rejects unsafe or extra data without reading accessors or proxies", () => {
  let reads = 0;
  const getter = fixture();
  Object.defineProperty(getter[13], "effect", { get() { reads += 1; return "read_referral_program"; } });
  expect(() => assertChatwootProviderCausalLedger(getter, "gap")).toThrow();
  const nested = fixture();
  Object.defineProperty(nested[13].credential_contract, "headers", { get() { reads += 1; return []; } });
  expect(() => projectChatwootProviderCausalEntries(nested, "gap")).toThrow();
  const proxied = new Proxy(fixture(), { get() { reads += 1; return undefined; } });
  expect(() => assertChatwootProviderCausalLedger(proxied, "gap")).toThrow();
  expect(reads).toBe(0);
  const extra = fixture();
  Object.defineProperty(extra[0], "unexpected", { value: "not-dropped" });
  expect(() => projectChatwootProviderCausalEntries(extra, "gap")).toThrow();
  const sparse = fixture();
  delete (sparse as unknown[])[13];
  expect(() => assertChatwootProviderCausalLedger(sparse, "gap")).toThrow();
});

test("keeps recreation explicitly uncharacterized instead of deriving a guessed suffix or count", () => {
  for (const entries of [[], fixture(), [...fixture(), ...fixture()]]) {
    expect(() => assertChatwootProviderCausalLedger(entries, "recreated"))
      .toThrow("Chatwoot recreated provider causal contract is uncharacterized.");
    expect(() => projectChatwootProviderCausalEntries(entries, "recreated"))
      .toThrow("Chatwoot recreated provider causal contract is uncharacterized.");
  }
  expect(() => assertChatwootProviderCausalLedger(fixture(), "unknown")).toThrow();
});

function fixture() {
  return CHATWOOT_INITIAL_PROVIDER_EFFECTS.map((effect: string, index: number) => ({
    sequence: index + 1,
    effect,
    method: index < 5 ? "POST" : "GET",
    pathname: `/synthetic/${effect}`,
    service: "synthetic-test-provider",
    query_keys: [],
    body_bytes: 0,
    body_contract: { format: "none", fields: [] },
    body_sha256: "0".repeat(64),
    credential_contract: { headers: [] as string[], cookies: [] },
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
  }));
}

function permutations(values: number[]): number[][] {
  if (values.length === 0) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, at) => at !== index))
    .map((tail) => [value, ...tail]));
}
