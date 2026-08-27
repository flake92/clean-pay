import { createRemnashopTransport } from "@/backend/integrations/remnashop/request-transport";
import { logger } from "@/backend/observability/logger";

export const remnashopTransport = createRemnashopTransport({
  requestSent({ method, path, hasBody, trace }) {
    logger.info("remnashop_request_sent", {
      method,
      path,
      hasBody,
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Request: ${method} ${path}`,
    });
  },
  responseReceived({ method, path, status, ok, durationMs, trace }) {
    logger.info("remnashop_response_received", {
      method,
      path,
      status,
      ok,
      durationMs,
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Response: ${method} ${path} -> ${status}`,
    });
  },
  requestFailed({ method, path, durationMs, error, trace }) {
    logger.error("remnashop_request_failed", {
      method,
      path,
      durationMs,
      errorName: error instanceof Error ? error.name : "UnknownError",
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Request failed: ${method} ${path}`,
    });
  },
  adminRequestSent({ method, path, hasBody, trace }) {
    logger.info("remnashop_admin_request_sent", {
      method,
      path,
      hasBody,
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Request: ${method} admin ${path}`,
    });
  },
  adminResponseReceived({
    method,
    path,
    status,
    ok,
    durationMs,
    trace,
  }) {
    logger.info("remnashop_admin_response_received", {
      method,
      path,
      status,
      ok,
      durationMs,
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Response: ${method} admin ${path} -> ${status}`,
    });
  },
  adminRequestFailed({ method, path, durationMs, error, trace }) {
    logger.error("remnashop_admin_request_failed", {
      method,
      path,
      durationMs,
      errorName: error instanceof Error ? error.name : "UnknownError",
      requestId: trace.requestId,
      traceId: trace.traceId,
    }, {
      category: "upstream",
      source: "remnashop.client",
      message: `HTTP Admin request failed: ${method} ${path}`,
    });
  },
});

export const { remnashopValidatedRequest } = remnashopTransport;
