import { types } from "node:util";

const maximumCaptureBytes = 64 * 1024;

export function attestJourneyCapturedLifecycle({
  containersByService,
  lifecycleNotBefore,
  oneShotServiceNames,
  sealed,
  serviceNames,
}) {
  exactKeys(arguments[0], [
    "containersByService",
    "lifecycleNotBefore",
    "oneShotServiceNames",
    "sealed",
    "serviceNames",
  ]);
  if (!Array.isArray(serviceNames) || serviceNames.length === 0
    || new Set(serviceNames).size !== serviceNames.length
    || serviceNames.some((service) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(service))
    || !(oneShotServiceNames instanceof Set)
    || [...oneShotServiceNames].some((service) => !serviceNames.includes(service))) {
    fail("Journey captured lifecycle service contract is invalid.");
  }
  const sealedLifecycle = assertSealedJourneyLifecycleEvents(sealed);
  const eventsByContainer = indexCapturedJourneyLifecycleEvents({
    containersByService,
    lifecycleNotBefore,
    oneShotServiceNames,
    sealed: sealedLifecycle,
    serviceNames,
  });
  return Object.freeze({
    attestedAt: dockerEventNanosecondsToIso(sealedLifecycle.endReceipt.timeNano),
    eventsByContainer,
  });
}

function assertSealedJourneyLifecycleEvents(value) {
  const bundle = exactCaptureDataObject(
    value,
    ["endReceipt", "output", "startReceipt"],
    "journey sealed lifecycle capture",
  );
  const startReceipt = assertJourneyLifecycleBarrierReceipt(bundle.startReceipt, "start");
  const endReceipt = assertJourneyLifecycleBarrierReceipt(bundle.endReceipt, "end");
  if (typeof bundle.output !== "string"
    || Buffer.byteLength(bundle.output, "utf8") > maximumCaptureBytes
    || bundle.output.length === 0 || bundle.output.includes("\0")) {
    fail("Journey live Docker event capture exceeds its bounded input contract.");
  }
  if (startReceipt.containerId === endReceipt.containerId
    || startReceipt.nonce === endReceipt.nonce
    || BigInt(startReceipt.timeNano) >= BigInt(endReceipt.timeNano)) {
    fail("Journey live Docker event capture barrier window is invalid.");
  }
  return Object.freeze({ endReceipt, output: bundle.output, startReceipt });
}

function assertJourneyLifecycleBarrierReceipt(value, expectedPhase) {
  const receipt = exactCaptureDataObject(
    value,
    ["containerId", "nonce", "phase", "timeNano"],
    "journey lifecycle barrier receipt",
  );
  if (receipt.phase !== expectedPhase
    || !/^[a-f0-9]{64}$/.test(receipt.containerId ?? "")
    || !/^[a-f0-9]{32}$/.test(receipt.nonce ?? "")
    || !/^[1-9]\d{15,24}$/.test(receipt.timeNano ?? "")) {
    fail("Journey lifecycle barrier receipt is invalid.");
  }
  return Object.freeze({
    containerId: receipt.containerId,
    nonce: receipt.nonce,
    phase: receipt.phase,
    timeNano: receipt.timeNano,
  });
}

function exactCaptureDataObject(value, expectedKeys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value)) {
    fail(`${label} is invalid.`);
  }
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    fail(`${label} is unreadable.`);
  }
  if (keys.some((key) => typeof key !== "string")
    || JSON.stringify([...keys].sort()) !== JSON.stringify([...expectedKeys].sort())) {
    fail(`${label} keys are not exact.`);
  }
  const result = {};
  for (const key of expectedKeys) {
    const descriptor = ownDataProperty(value, key);
    if (descriptor.status !== "present") fail(`${label} contains an unreadable property.`);
    result[key] = descriptor.value;
  }
  return result;
}

function indexCapturedJourneyLifecycleEvents({
  containersByService,
  lifecycleNotBefore,
  oneShotServiceNames,
  sealed,
  serviceNames,
}) {
  if (containersByService === null || typeof containersByService !== "object"
    || Array.isArray(containersByService) || isProxy(containersByService)
    || JSON.stringify(Object.keys(containersByService).sort())
      !== JSON.stringify([...serviceNames].sort())) {
    fail("Journey captured lifecycle container set is invalid.");
  }
  const serviceById = new Map();
  for (const service of serviceNames) {
    const container = containersByService[service];
    if (container === null || typeof container !== "object" || Array.isArray(container)
      || isProxy(container) || !/^[a-f0-9]{64}$/.test(container.Id ?? "")
      || serviceById.has(container.Id)) {
      fail("Journey captured lifecycle container identity is invalid.");
    }
    serviceById.set(container.Id, service);
  }
  const byContainer = new Map([...serviceById.keys()].map((id) => [id, []]));
  const { endReceipt, output, startReceipt } = sealed;
  const lines = exactCapturedJourneyLifecycleLines(output);
  const expectedStart = `${startReceipt.timeNano}|create|${startReceipt.containerId}`
    + `|journey-event-barrier|${startReceipt.nonce}`;
  const expectedEnd = `${endReceipt.timeNano}|create|${endReceipt.containerId}`
    + `|journey-event-barrier|${endReceipt.nonce}`;
  if (lines[0] !== expectedStart || lines.at(-1) !== expectedEnd) {
    fail("Journey live Docker event capture is not bound to its exact barrier receipts.");
  }
  const startTime = BigInt(startReceipt.timeNano);
  const endTime = BigInt(endReceipt.timeNano);
  const sharedLowerBound = lifecycleNotBefore === undefined
    ? startTime
    : BigInt(exactTimestamp(lifecycleNotBefore, "journey captured lifecycle lower bound"))
      * 1_000_000n;
  let previousTime = 0n;
  let barrierCount = 0;
  for (const [index, line] of lines.entries()) {
    const match = /^(?<timeNano>[1-9]\d{15,24})\|(?<action>create|start|die|restart)\|(?<id>[a-f0-9]{64})\|(?<service>[a-z0-9][a-z0-9-]{0,63})\|(?<barrier>-|[a-f0-9]{32})$/.exec(line);
    if (!match) fail("Journey live Docker event capture contains an invalid record.");
    const { action, barrier, id, service, timeNano } = match.groups;
    const currentTime = BigInt(timeNano);
    if (currentTime < previousTime) {
      fail("Journey live Docker event capture is not chronologically ordered.");
    }
    previousTime = currentTime;
    if (service === "journey-event-barrier") {
      const isStart = index === 0 && line === expectedStart;
      const isEnd = index === lines.length - 1 && line === expectedEnd;
      if (action !== "create" || barrier === "-" || serviceById.has(id)
        || (!isStart && !isEnd)) {
        fail("Journey live Docker event capture contains an invalid barrier record.");
      }
      barrierCount += 1;
      continue;
    }
    if (barrier !== "-" || serviceById.get(id) !== service
      || !serviceNames.includes(service)
      || currentTime <= startTime || currentTime < sharedLowerBound || currentTime > endTime) {
      fail("Journey live Docker event capture is unbound from the inspected project runtime.");
    }
    byContainer.get(id).push(`${timeNano} ${action} ${id}`);
  }
  if (barrierCount !== 2) {
    fail("Journey live Docker event capture did not cross two exact barriers.");
  }
  for (const [id, service] of serviceById) {
    const records = byContainer.get(id);
    const actions = records.map((line) => line.split(" ")[1]);
    const expectedActions = oneShotServiceNames.has(service)
      ? ["create", "start", "die"]
      : ["create", "start"];
    const times = records.map((line) => BigInt(line.split(" ")[0]));
    if (JSON.stringify(actions) !== JSON.stringify(expectedActions)
      || times.some((time, index) => index > 0 && time <= times[index - 1])) {
      fail("Journey live Docker event capture differs from the exact service lifecycle.");
    }
  }
  return byContainer;
}

function exactCapturedJourneyLifecycleLines(output) {
  const lines = output.split("\n");
  if (lines.some((line) => line.length === 0 || line.includes("\r"))) {
    fail("Journey live Docker event capture contains an invalid line boundary.");
  }
  return lines;
}

export function dockerEventNanosecondsToIso(value) {
  if (!/^[1-9]\d{15,24}$/.test(value ?? "")) {
    fail("Journey Docker event timestamp is invalid.");
  }
  const milliseconds = BigInt(value) / 1_000_000n;
  if (milliseconds > 8_640_000_000_000_000n) {
    fail("Journey Docker event timestamp exceeds the ECMAScript date range.");
  }
  try {
    return new Date(Number(milliseconds)).toISOString();
  } catch {
    fail("Journey Docker event timestamp is invalid.");
  }
}

function exactTimestamp(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    fail(`${label} is invalid.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) fail(`${label} is invalid.`);
  return milliseconds;
}

function exactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail("Journey captured lifecycle input keys are not exact.");
  }
}

function ownDataProperty(value, name) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor === undefined) return { status: "absent" };
    return Object.hasOwn(descriptor, "value")
      ? { status: "present", value: descriptor.value }
      : { status: "unreadable" };
  } catch {
    return { status: "unreadable" };
  }
}

function isProxy(value) {
  try {
    return types.isProxy(value);
  } catch {
    return true;
  }
}

function fail(message) {
  throw new Error(message);
}
