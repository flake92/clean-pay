export function assessReadinessResponse(response) {
  let body = null;

  try {
    body = JSON.parse(response.body);
  } catch {
    return { ready: false, body: null, reason: "readiness response is not valid JSON" };
  }

  const checks = body?.checks && typeof body.checks === "object"
    ? Object.values(body.checks)
    : [];
  const failedChecks = checks.filter((check) => check?.status !== "ok");
  const ready = response.status === 200
    && body?.status === "ok"
    && checks.length > 0
    && failedChecks.length === 0;

  if (ready) {
    return { ready: true, body, reason: null };
  }

  const failedNames = body?.checks && typeof body.checks === "object"
    ? Object.entries(body.checks)
      .filter(([, check]) => check?.status !== "ok")
      .map(([name]) => name)
    : [];
  const reason = failedNames.length > 0
    ? `critical dependencies are not ready: ${failedNames.join(", ")}`
    : `readiness returned HTTP ${response.status} with status ${String(body?.status ?? "missing")}`;

  return { ready: false, body, reason };
}
