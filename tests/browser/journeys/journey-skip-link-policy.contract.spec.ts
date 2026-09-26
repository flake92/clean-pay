import sharp from "sharp";

import { expect, test } from "@playwright/test";

import {
  JOURNEY_SYNTHETIC_HOSTNAMES,
  JOURNEY_SYNTHETIC_TLS_POLICY,
  journeyProvenanceLaunchArgs,
} from "./journey-browser-policy";

import { projectCharacterizationManifestForComparison } from "../comparison-projection";
import { assertExactJourneyKeyboardSkipLinkScreenshot } from "./journey-skip-link-policy";

test("projects only the exact approved first-Tab skip-link state", () => {
  expect(project(candidateEvidence())).toEqual(project(baselineEvidence()));

  const wrongRoute = candidateEvidence();
  wrongRoute.checkpoints[0]!.url.pathname = "/register";
  expect(project(wrongRoute)).not.toEqual(project(baselineEvidence()));

  const wrongFocus = candidateEvidence();
  ((wrongFocus.checkpoints[0] as unknown as {
    focus: { name: string };
  }).focus).name = "Different";
  expect(project(wrongFocus)).not.toEqual(project(baselineEvidence()));

  const wrongStyle = candidateEvidence();
  ((wrongStyle.checkpoints[0] as unknown as {
    computedStyles: Array<{ style: Record<string, string> }>;
  }).computedStyles[0]!.style)["z-index"] = "9999";
  expect(project(wrongStyle)).not.toEqual(project(baselineEvidence()));
});

test("accepts exact pixels only inside the declared skip-link paint bounds", async () => {
  const expected = await solidPng(200, 100, { r: 255, g: 255, b: 255, alpha: 1 });
  const actual = await sharp(expected)
    .composite([{ input: await solidPng(120, 48, { r: 49, g: 46, b: 129, alpha: 1 }), left: 16, top: 16 }])
    .png()
    .toBuffer();
  await expect(compare(expected, actual)).resolves.toBe(true);

  const outside = await sharp(actual)
    .composite([{ input: await solidPng(1, 1, { r: 0, g: 0, b: 0, alpha: 1 }), left: 0, top: 0 }])
    .png()
    .toBuffer();
  await expect(compare(expected, outside)).resolves.toBe(false);
  await expect(compare(expected, expected)).resolves.toBe(false);
});

test("keeps screenshot route, checkpoint, focus, and style near misses fail-closed", async () => {
  const expected = await solidPng(200, 100, { r: 255, g: 255, b: 255, alpha: 1 });
  const actual = await sharp(expected)
    .composite([{ input: await solidPng(120, 48, { r: 49, g: 46, b: 129, alpha: 1 }), left: 16, top: 16 }])
    .png()
    .toBuffer();
  const candidate = candidateEvidence();
  ((candidate.checkpoints[0] as unknown as {
    computedStyles: Array<{ box: { x: number } }>;
  }).computedStyles[0]!.box).x = 17;
  await expect(compare(expected, actual, candidate)).resolves.toBe(false);
  await expect(compare(expected, actual, candidateEvidence(), "public-login"))
    .resolves.toBe(false);
  await expect(compare(expected, actual, candidateEvidence(), "keyboard-login-first-tab", "/wrong"))
    .resolves.toBe(false);
});

function project(value: unknown) {
  return projectCharacterizationManifestForComparison(value);
}

async function compare(
  expectedPng: Buffer,
  actualPng: Buffer,
  actual = candidateEvidence(),
  label = "keyboard-login-first-tab",
  journeyId = "public-responsive-keyboard-install-offline-support",
) {
  return assertExactJourneyKeyboardSkipLinkScreenshot({
    project: "journey-390x844",
    journeyId,
    label,
    expectedEvidence: jsonBytes(baselineEvidence()),
    actualEvidence: jsonBytes(actual),
    expectedPng,
    actualPng,
  });
}

function baselineEvidence() {
  return evidence({
    focus: { tag: "input", role: null, name: "" },
    dom: layoutDom(false),
    computedStyles: [],
    interactiveElements: [],
    ariaSnapshot: "- main:",
  });
}

function candidateEvidence() {
  return evidence({
    focus: { tag: "a", role: null, name: "К основному содержимому" },
    dom: layoutDom(true),
    computedStyles: [skipStyle()],
    interactiveElements: [{
      path: "html > body > div > a",
      tag: "a",
      role: null,
      text: "К основному содержимому",
      ariaLabel: null,
      href: "/login#<fragment>",
      visible: true,
      disabled: false,
      loading: false,
    }],
    ariaSnapshot: [
      '- link "К основному содержимому":',
      '  - /url: {"origin":"<app-origin>","pathname":"/login","query":[],"fragment":"<sha256:0c1923dd7ec27396>"}',
      "- main:",
    ].join("\n"),
  });
}

function evidence(checkpoint: Record<string, unknown>) {
  const focus = checkpoint.focus as { tag: string; role: null; name: string };
  return {
    schemaVersion: 2,
    baselineCommit: "f5cb6f543d85256e7733a1ade6a4f451d86cf378",
    source: {
      revision: "1".repeat(40),
      imageDigest: `sha256:${"2".repeat(64)}`,
      imageTag: "synthetic:journey",
      migrationImageDigest: `sha256:${"6".repeat(64)}`,
      migrationImageTag: "synthetic:journey-migration",
      publicBuildContract: { version: "1", sha256: "3".repeat(64) },
      fixtureContract: { version: "journey-v5", sha256: "4".repeat(64) },
      browser: {
        engine: "chromium",
        version: "140.0.0.0",
        playwright: "1.62.1",
        launchArgs: journeyProvenanceLaunchArgs(),
        syntheticHostnames: [...JOURNEY_SYNTHETIC_HOSTNAMES],
        tlsPolicy: { ...JOURNEY_SYNTHETIC_TLS_POLICY },
      },
    },
    project: "journey-390x844",
    journey: "public-responsive-keyboard-install-offline-support",
    checkpoints: [{
      label: "keyboard-login-first-tab",
      url: { origin: "<app-origin>", pathname: "/login", query: [], fragment: null },
      screenshot: { bytes: 1000, sha256: "5".repeat(64) },
      ...checkpoint,
    }],
    boundaries: [{ label: "keyboard-first-tab", value: { ...focus } }],
  };
}

function layoutDom(candidate: boolean) {
  const children = [element("div", { class: "layout-main-container" }, [
    element("main", candidate
      ? { class: "layout-main", id: "main-content", tabindex: "-1" }
      : { class: "layout-main" }),
  ])];
  if (candidate) {
    children.unshift(element("a", {
      class: "skip-link",
      href: "/login#<fragment>",
    }, [{ type: "text", value: "К основному содержимому" }]));
  }
  return element("html", {}, [element("body", {}, [
    element("div", { class: "layout-wrapper layout-static p-ripple-disabled" }, children),
  ])]);
}

function element(
  tag: string,
  attributes: Record<string, string> = {},
  children: Array<Record<string, unknown>> = [],
) {
  return {
    type: "element",
    tag,
    attributes: Object.entries(attributes)
      .map(([name, value]) => ({ name, value }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    children,
  };
}

function skipStyle() {
  const style = Object.fromEntries([
    "align-items", "background-color", "border-bottom-color",
    "border-bottom-left-radius", "border-bottom-right-radius", "border-bottom-style",
    "border-bottom-width", "border-left-color", "border-left-style", "border-left-width",
    "border-right-color", "border-right-style", "border-right-width", "border-top-color",
    "border-top-left-radius", "border-top-right-radius", "border-top-style", "border-top-width",
    "box-shadow", "color", "display", "flex-direction", "font-family", "font-size",
    "font-weight", "gap", "justify-content", "line-height", "margin-bottom", "margin-left",
    "margin-right", "margin-top", "max-width", "min-height", "opacity", "overflow",
    "padding-bottom", "padding-left", "padding-right", "padding-top", "position", "text-align",
    "visibility", "white-space", "z-index",
  ].map((name) => [name, "normal"]));
  Object.assign(style, {
    "background-color": "rgb(255, 255, 255)",
    "border-bottom-color": "rgb(99, 102, 241)",
    "border-left-color": "rgb(99, 102, 241)",
    "border-right-color": "rgb(99, 102, 241)",
    "border-top-color": "rgb(99, 102, 241)",
    "border-bottom-left-radius": "6px",
    "border-bottom-right-radius": "6px",
    "border-top-left-radius": "6px",
    "border-top-right-radius": "6px",
    "border-bottom-style": "solid",
    "border-left-style": "solid",
    "border-right-style": "solid",
    "border-top-style": "solid",
    "border-bottom-width": "2px",
    "border-left-width": "2px",
    "border-right-width": "2px",
    "border-top-width": "2px",
    "box-shadow": "rgba(99, 102, 241, 0.22) 0px 0px 0px 3.2px",
    color: "rgb(49, 46, 129)",
    "font-weight": "700",
    "padding-bottom": "12px",
    "padding-left": "16px",
    "padding-right": "16px",
    "padding-top": "12px",
    position: "fixed",
    visibility: "visible",
    opacity: "1",
    "z-index": "10000",
  });
  return {
    path: "html > body > div > a",
    tag: "a",
    visible: true,
    box: { x: 16, y: 16, width: 120, height: 48 },
    style,
  };
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function solidPng(
  width: number,
  height: number,
  background: { r: number; g: number; b: number; alpha: number },
) {
  return sharp({ create: { width, height, channels: 4, background } }).png().toBuffer();
}
