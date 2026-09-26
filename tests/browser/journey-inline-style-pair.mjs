// Pair-only normalization of an intentionally tiny CSS declaration language.
// No sorting, cascade rewriting, arbitrary values, CSS functions or comments.
export function canonicalSimpleInlineStyle(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  let declarations = value.trim().split(";");
  if (declarations.at(-1) === "") declarations.pop();
  if (declarations.length < 1 || declarations.length > 8) return null;
  const result = [];
  for (const declaration of declarations) {
    const match = /^\s*(width|height|overflow|display)\s*:\s*([a-z0-9.%]+)\s*(!important)?\s*$/.exec(declaration);
    if (!match) return null;
    const [, property, token, priority = ""] = match;
    const valid = property === "overflow" ? /^(auto|hidden|visible|scroll|clip)$/.test(token)
      : property === "display" ? token === "flex"
      : /^(?:0|\d+(?:\.\d+)?(?:px|em|rem|%))$/.test(token);
    if (!valid) return null;
    result.push(`${property}:${token}${priority};`);
  }
  return result.join("");
}

/** Caller must separately verify paired revision/fixture provenance. */
export function projectPairedJourneyInlineStyles(expected, actual) {
  const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!record(expected) || !record(actual) || expected.schemaVersion !== 2 || actual.schemaVersion !== 2
    || expected.project !== actual.project || expected.journey !== actual.journey
    || !Array.isArray(expected.checkpoints) || !Array.isArray(actual.checkpoints)
    || expected.checkpoints.length !== actual.checkpoints.length) return 0;
  let normalized = 0;
  const visit = (a, b, depth) => {
    if (depth > 256 || !record(a) || !record(b) || a.type !== "element" || b.type !== "element"
      || a.tag !== b.tag || !Array.isArray(a.attributes) || !Array.isArray(b.attributes)
      || a.attributes.length !== b.attributes.length) return;
    if (a.attributes.some((attr, i) => !record(attr) || !record(b.attributes[i]) || attr.name !== b.attributes[i].name)) return;
    const stylesA = a.attributes.filter((attr) => attr.name === "style");
    const stylesB = b.attributes.filter((attr) => attr.name === "style");
    if (stylesA.length === 1 && stylesB.length === 1 && stylesA[0].value !== stylesB[0].value) {
      const first = canonicalSimpleInlineStyle(stylesA[0].value);
      const second = canonicalSimpleInlineStyle(stylesB[0].value);
      if (first !== null && first === second) {
        stylesA[0].value = first; stylesB[0].value = second; normalized++;
      }
    }
    if (!Array.isArray(a.children) || !Array.isArray(b.children) || a.children.length !== b.children.length) return;
    for (let i = 0; i < a.children.length; i++) visit(a.children[i], b.children[i], depth + 1);
  };
  for (let i = 0; i < expected.checkpoints.length; i++) {
    const a = expected.checkpoints[i], b = actual.checkpoints[i];
    if (record(a) && record(b) && a.label === b.label) visit(a.dom, b.dom, 0);
  }
  return normalized;
}
