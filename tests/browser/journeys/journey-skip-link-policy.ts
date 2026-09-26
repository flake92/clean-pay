import sharp from "sharp";

const JOURNEY = "public-responsive-keyboard-install-offline-support";
const CHECKPOINT = "keyboard-login-first-tab";
const BOUNDARY = "keyboard-first-tab";
const TEXT = "К основному содержимому";
const PATHNAME = "/login";
const STYLE_KEYS = [
  "align-items",
  "background-color",
  "border-bottom-color",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-bottom-style",
  "border-bottom-width",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-top-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-top-style",
  "border-top-width",
  "box-shadow",
  "color",
  "display",
  "flex-direction",
  "font-family",
  "font-size",
  "font-weight",
  "gap",
  "justify-content",
  "line-height",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-width",
  "min-height",
  "opacity",
  "overflow",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "position",
  "text-align",
  "visibility",
  "white-space",
  "z-index",
].sort();

type PaintBox = { x: number; y: number; width: number; height: number };

/** Projects only the approved first-Tab skip-link state. */
export function projectExactJourneyKeyboardSkipLink(manifest: Record<string, unknown>) {
  const contract = keyboardContract(manifest);
  if (!contract) return;
  contract.checkpoint.focus = {
    tag: "input",
    role: null,
    name: "",
  };
  contract.checkpoint.screenshot = {
    bytes: "<keyboard-skip-link-policy>",
    sha256: "<keyboard-skip-link-policy>",
  };
  contract.boundary.value = {
    tag: "input",
    role: null,
    name: "",
  };
  if (contract.variant === "candidate") {
    contract.checkpoint.computedStyles = (contract.checkpoint.computedStyles as unknown[]).filter(
      (value) => value !== contract.focusedStyle,
    );
  }
}

export async function assertExactJourneyKeyboardSkipLinkScreenshot(options: {
  project: string;
  journeyId: string;
  label: string;
  expectedEvidence: Uint8Array;
  actualEvidence: Uint8Array;
  expectedPng: Uint8Array;
  actualPng: Uint8Array;
}) {
  if (
    options.journeyId !== JOURNEY
    || options.label !== CHECKPOINT
    || !/^journey-(?:390x844|768x1024|1440x900)$/.test(options.project)
  ) {
    return false;
  }
  const expected = parseEvidence(options.expectedEvidence);
  const actual = parseEvidence(options.actualEvidence);
  const baselineContract = expected && keyboardContract(expected);
  const candidateContract = actual && keyboardContract(actual);
  if (
    !baselineContract
    || baselineContract.variant !== "baseline"
    || !candidateContract
    || candidateContract.variant !== "candidate"
    || expected?.project !== options.project
    || actual?.project !== options.project
    || expected?.journey !== options.journeyId
    || actual?.journey !== options.journeyId
  ) {
    return false;
  }

  const expectedRaster = await decodePng(options.expectedPng);
  const actualRaster = await decodePng(options.actualPng);
  if (
    expectedRaster.width !== actualRaster.width
    || expectedRaster.height !== actualRaster.height
    || expectedRaster.channels !== actualRaster.channels
    || expectedRaster.channels !== 4
  ) {
    return false;
  }
  const bounds = paintBounds(candidateContract.paintBox, actualRaster.width, actualRaster.height);
  let insideDifferences = 0;
  for (let y = 0; y < actualRaster.height; y += 1) {
    for (let x = 0; x < actualRaster.width; x += 1) {
      const offset = (y * actualRaster.width + x) * actualRaster.channels;
      let pixelDiffers = false;
      for (let channel = 0; channel < actualRaster.channels; channel += 1) {
        if (expectedRaster.data[offset + channel] !== actualRaster.data[offset + channel]) {
          pixelDiffers = true;
          break;
        }
      }
      if (!pixelDiffers) continue;
      const inside = x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom;
      if (!inside) return false;
      insideDifferences += 1;
    }
  }
  return insideDifferences > 0;
}

function keyboardContract(manifest: Record<string, unknown>) {
  if (
    manifest.schemaVersion !== 2
    || manifest.journey !== JOURNEY
    || typeof manifest.project !== "string"
    || !/^journey-(?:390x844|768x1024|1440x900)$/.test(manifest.project)
    || !Array.isArray(manifest.checkpoints)
    || !Array.isArray(manifest.boundaries)
  ) {
    return null;
  }
  const checkpoints = manifest.checkpoints.filter(
    (value) => isRecord(value) && value.label === CHECKPOINT,
  );
  const boundaries = manifest.boundaries.filter(
    (value) => isRecord(value) && value.label === BOUNDARY,
  );
  if (checkpoints.length !== 1 || boundaries.length !== 1) return null;
  const checkpoint = checkpoints[0] as Record<string, unknown>;
  const boundary = boundaries[0] as Record<string, unknown>;
  if (
    !isExactLoginUrl(checkpoint.url)
    || !isRecord(checkpoint.screenshot)
    || !isDigest(checkpoint.screenshot)
    || !Array.isArray(checkpoint.computedStyles)
    || !Array.isArray(checkpoint.interactiveElements)
  ) {
    return null;
  }

  const baselineFocus = isExactFocus(checkpoint.focus, "input", "")
    && isExactFocus(boundary.value, "input", "");
  if (baselineFocus && !findSkipLinkPath(checkpoint.dom)) {
    return { variant: "baseline" as const, checkpoint, boundary };
  }

  if (
    !isExactFocus(checkpoint.focus, "a", TEXT)
    || !isExactFocus(boundary.value, "a", TEXT)
  ) {
    return null;
  }
  const skipPath = findSkipLinkPath(checkpoint.dom);
  if (!skipPath) return null;
  const focusedStyles = checkpoint.computedStyles.filter(
    (value) => isExactFocusedSkipStyle(value, skipPath),
  );
  const interactives = checkpoint.interactiveElements.filter(
    (value) => isExactSkipInteractive(value, skipPath),
  );
  if (
    focusedStyles.length !== 1
    || interactives.length !== 1
    || !hasExactSkipAria(checkpoint.ariaSnapshot)
  ) {
    return null;
  }
  const focusedStyle = focusedStyles[0] as Record<string, unknown>;
  return {
    variant: "candidate" as const,
    checkpoint,
    boundary,
    focusedStyle,
    paintBox: focusedStyle.box as PaintBox,
  };
}

function isExactLoginUrl(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["fragment", "origin", "pathname", "query"])
    && value.origin === "<app-origin>"
    && value.pathname === PATHNAME
    && Array.isArray(value.query)
    && value.query.length === 0
    && value.fragment === null;
}

function isExactFocus(value: unknown, tag: string, name: string) {
  return isRecord(value)
    && hasExactKeys(value, ["name", "role", "tag"])
    && value.tag === tag
    && value.role === null
    && value.name === name;
}

function findSkipLinkPath(value: unknown) {
  let path: string | null = null;
  const visit = (node: unknown, currentPath: string, parent: Record<string, unknown> | null) => {
    if (!isDomElement(node)) return;
    if (
      node.tag === "a"
      && getAttribute(parent, "class") === "layout-wrapper layout-static p-ripple-disabled"
      && hasExactAttributes(node, { class: "skip-link", href: "/login#<fragment>" })
      && exactText(node) === TEXT
    ) {
      if (path !== null) path = "<duplicate>";
      else path = currentPath;
    }
    const children = Array.isArray(node.children) ? node.children.filter(isDomElement) : [];
    for (const child of children) {
      const sameTag = children.filter((candidate) => candidate.tag === child.tag);
      const position = sameTag.length > 1
        ? `:nth-of-type(${sameTag.indexOf(child) + 1})`
        : "";
      visit(child, `${currentPath} > ${child.tag}${position}`, node);
    }
  };
  if (isDomElement(value)) visit(value, value.tag as string, null);
  return path === "<duplicate>" ? null : path;
}

function isExactFocusedSkipStyle(value: unknown, path: string) {
  if (
    !isRecord(value)
    || hasExactKeys(value, ["box", "path", "style", "tag", "visible"]) === false
    || value.path !== path
    || value.tag !== "a"
    || value.visible !== true
    || !isRecord(value.box)
    || !isRecord(value.style)
    || !hasExactKeys(value.style, STYLE_KEYS)
  ) {
    return false;
  }
  const box = value.box;
  const style = value.style;
  return box.x === 16
    && box.y === 16
    && typeof box.width === "number"
    && box.width > 100
    && box.width < 320
    && typeof box.height === "number"
    && box.height >= 40
    && box.height <= 64
    && style["background-color"] === "rgb(255, 255, 255)"
    && style["border-top-color"] === "rgb(99, 102, 241)"
    && style["border-right-color"] === "rgb(99, 102, 241)"
    && style["border-bottom-color"] === "rgb(99, 102, 241)"
    && style["border-left-color"] === "rgb(99, 102, 241)"
    && style["border-top-style"] === "solid"
    && style["border-right-style"] === "solid"
    && style["border-bottom-style"] === "solid"
    && style["border-left-style"] === "solid"
    && style["border-top-width"] === "2px"
    && style["border-right-width"] === "2px"
    && style["border-bottom-width"] === "2px"
    && style["border-left-width"] === "2px"
    && style["border-top-left-radius"] === "6px"
    && style["border-top-right-radius"] === "6px"
    && style["border-bottom-left-radius"] === "6px"
    && style["border-bottom-right-radius"] === "6px"
    && style["box-shadow"] === "rgba(99, 102, 241, 0.22) 0px 0px 0px 3.2px"
    && style.color === "rgb(49, 46, 129)"
    && style["font-weight"] === "700"
    && style["padding-top"] === "12px"
    && style["padding-right"] === "16px"
    && style["padding-bottom"] === "12px"
    && style["padding-left"] === "16px"
    && style.position === "fixed"
    && style.visibility === "visible"
    && style.opacity === "1"
    && style["z-index"] === "10000";
}

function isExactSkipInteractive(value: unknown, path: string) {
  return isRecord(value)
    && hasExactKeys(value, [
      "ariaLabel", "disabled", "href", "loading", "path", "role", "tag", "text", "visible",
    ])
    && value.path === path
    && value.tag === "a"
    && value.role === null
    && value.text === TEXT
    && value.ariaLabel === null
    && value.href === "/login#<fragment>"
    && value.visible === true
    && value.disabled === false
    && value.loading === false;
}

function hasExactSkipAria(value: unknown) {
  if (typeof value !== "string") return false;
  const lines = value.split("\n");
  const index = lines.indexOf(`- link "${TEXT}":`);
  return index >= 0
    && lines.filter((line) => line === `- link "${TEXT}":`).length === 1
    && lines[index + 1]
      === '  - /url: {"origin":"<app-origin>","pathname":"/login","query":[],"fragment":"<sha256:0c1923dd7ec27396>"}';
}

async function decodePng(value: Uint8Array) {
  const { data, info } = await sharp(Buffer.from(value))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function paintBounds(box: PaintBox, width: number, height: number) {
  const spread = 3.2;
  return {
    left: Math.max(0, Math.floor(box.x - spread)),
    top: Math.max(0, Math.floor(box.y - spread)),
    right: Math.min(width, Math.ceil(box.x + box.width + spread)),
    bottom: Math.min(height, Math.ceil(box.y + box.height + spread)),
  };
}

function isDigest(value: Record<string, unknown>) {
  return hasExactKeys(value, ["bytes", "sha256"])
    && Number.isSafeInteger(value.bytes)
    && typeof value.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.sha256);
}

function isDomElement(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.type === "element" && typeof value.tag === "string";
}

function attributeMap(node: Record<string, unknown> | null) {
  const result = new Map<string, string>();
  if (!node || !Array.isArray(node.attributes)) return result;
  for (const attribute of node.attributes) {
    if (isRecord(attribute) && typeof attribute.name === "string" && typeof attribute.value === "string") {
      result.set(attribute.name, attribute.value);
    }
  }
  return result;
}

function getAttribute(node: Record<string, unknown> | null, name: string) {
  return attributeMap(node).get(name) ?? null;
}

function hasExactAttributes(node: Record<string, unknown>, expected: Record<string, string>) {
  const actual = attributeMap(node);
  return actual.size === Object.keys(expected).length
    && Object.entries(expected).every(([name, value]) => actual.get(name) === value);
}

function exactText(node: Record<string, unknown>) {
  if (!Array.isArray(node.children) || node.children.length !== 1) return null;
  const child = node.children[0];
  return isRecord(child) && child.type === "text" && typeof child.value === "string"
    ? child.value
    : null;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length
    && actual.every((key, index) => key === keys[index]);
}

function parseEvidence(value: Uint8Array) {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value).toString("utf8"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
