const projectNames = Object.freeze([
  "chromium-390x844",
  "chromium-768x1024",
  "chromium-1440x900",
]);

const routeNames = Object.freeze([
  "login",
  "register",
  "tariffs",
  "support",
  "install",
  "offline",
  "protected-cabinet",
  "protected-profile",
  "protected-referral",
  "protected-extend",
  "protected-link-account",
  "protected-verify-email",
  "protected-passkey-setup",
  "protected-payment",
]);

const artifactNames = Object.freeze([
  "characterization.json",
  "console.json",
  "viewport.png",
]);

const maximumArtifactPaths = 512;
const maximumArtifactPathBytes = 512;
const maximumArtifactSegments = 16;
const safeArtifactSegmentPattern = /^[a-z0-9][a-z0-9.-]{0,79}$/;

export function derivePublicOverlapOwnershipDirectoryPaths(artifactPaths) {
  if (!Array.isArray(artifactPaths)
    || artifactPaths.length < 1
    || artifactPaths.length > maximumArtifactPaths) {
    throw new Error("Public overlap ownership artifact path ledger is invalid.");
  }
  const uniqueArtifactPaths = new Set();
  const directoryPaths = new Set([".", "artifacts"]);
  for (const artifactPath of artifactPaths) {
    const segments = typeof artifactPath === "string" ? artifactPath.split("/") : [];
    if (typeof artifactPath !== "string"
      || Buffer.byteLength(artifactPath, "utf8") > maximumArtifactPathBytes
      || artifactPath.includes("\\")
      || artifactPath.startsWith("/")
      || segments.length < 2
      || segments.length > maximumArtifactSegments
      || segments.some((segment) => !safeArtifactSegmentPattern.test(segment))
      || uniqueArtifactPaths.has(artifactPath)) {
      throw new Error("Public overlap ownership artifact path ledger is invalid.");
    }
    uniqueArtifactPaths.add(artifactPath);
    let current = "artifacts";
    for (const segment of segments.slice(0, -1)) {
      current = `${current}/${segment}`;
      directoryPaths.add(current);
    }
  }
  return Object.freeze([...directoryPaths].sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || left.localeCompare(right);
  }));
}

const canonicalArtifactPaths = projectNames.flatMap((project) => (
  routeNames.flatMap((route) => (
    artifactNames.map((artifact) => `${project}/${route}/${artifact}`)
  ))
));

export const PUBLIC_OVERLAP_OWNERSHIP_DIRECTORY_PATHS =
  derivePublicOverlapOwnershipDirectoryPaths(canonicalArtifactPaths);

if (canonicalArtifactPaths.length !== 126
  || PUBLIC_OVERLAP_OWNERSHIP_DIRECTORY_PATHS.length !== 47) {
  throw new Error("Public overlap canonical ownership directory policy is invalid.");
}
