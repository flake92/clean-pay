import { NextRequest, NextResponse } from 'next/server';

import { logger } from "@/backend/observability/logger";
import { validateRequestSource } from "@/backend/security/csrf";
import {
  passkeySetupPath,
  registrationEmailVerificationPath,
} from "@/shared/auth/account-setup-flow";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";
import { buildContentSecurityPolicy } from "@/shared/security/content-security-policy";
import { REFERRAL_ATTRIBUTION_COOKIE_NAME } from "@/shared/domain/referrals";

const accessCookieName = 'clean_pay_access';
const refreshCookieName = 'clean_pay_refresh';

const paymentReconciliationInternalPath = '/api/internal/payments/reconcile';
const readinessInternalPath = '/api/internal/health/readiness';
const metricsInternalPath = '/api/internal/metrics';
const sessionRefreshPath = '/auth/session/refresh';
const providerSessionRecoveryPath = '/auth/session/recover';
const providerSessionRecoveryPagePath = '/auth/session/recovery';

type RequestSecurityContext = {
  contentSecurityPolicy: string;
  requestHeaders: Headers;
  requestId: string;
  traceId: string;
};

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function requestSecurityContext(request: NextRequest): RequestSecurityContext {
  const suppliedRequestId = request.headers.get('x-request-id')?.trim() ?? '';
  const requestId = /^[A-Za-z0-9._:-]{8,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : crypto.randomUUID();
  const suppliedTraceparent = request.headers.get('traceparent')?.trim().toLowerCase() ?? '';
  const traceMatch = suppliedTraceparent.match(
    /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/,
  );
  const suppliedTraceId = traceMatch?.[1];
  const traceId = suppliedTraceId && !/^0+$/.test(suppliedTraceId)
    ? suppliedTraceId
    : randomHex(16);
  const traceFlags = traceMatch?.[3] ?? '01';
  const nonce = randomHex(16);
  const chatwootConfigured = Boolean(
    process.env.CHATWOOT_BASE_URL?.trim()
    && process.env.CHATWOOT_WEBSITE_TOKEN?.trim()
    && process.env.CHATWOOT_HMAC_TOKEN?.trim(),
  );
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    chatwootBaseUrl: chatwootConfigured
      ? process.env.CHATWOOT_BASE_URL?.trim()
      : null,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('content-security-policy', contentSecurityPolicy);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set(
    'traceparent',
    `00-${traceId}-${randomHex(8)}-${traceFlags}`,
  );
  requestHeaders.set('x-clean-pay-trace-id', traceId);

  return { contentSecurityPolicy, requestHeaders, requestId, traceId };
}

function secureResponse<T extends NextResponse>(
  response: T,
  context: RequestSecurityContext,
) {
  response.headers.set('content-security-policy', context.contentSecurityPolicy);
  response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  response.headers.set('x-request-id', context.requestId);
  response.headers.set('x-clean-pay-trace-id', context.traceId);
  return response;
}

function continueRequest(context: RequestSecurityContext) {
  return secureResponse(NextResponse.next({
    request: { headers: context.requestHeaders },
  }), context);
}

const publicPagePaths = new Set([
  '/manifest.webmanifest',
  '/install',
  '/offline',
  '/login',
  '/register',
  '/support',
  '/tariffs',
  '/auth/telegram/start',
  '/auth/telegram/callback',
  '/auth/telegram/webapp',
  sessionRefreshPath,
  providerSessionRecoveryPath,
  providerSessionRecoveryPagePath,
]);

const publicApiPaths = new Set([
  '/api/health',
  '/api/health/liveness',
  '/api/health/readiness',
]);

// These legacy browser endpoints were removed. Let Next.js resolve them to a
// real 404 instead of turning a nonexistent transport into an authentication
// oracle at the proxy boundary.
const removedBrowserTransportPaths = new Set([
  '/api/me',
  '/api/logout',
  '/api/bff/auth/me',
  '/api/bff/subscription/current',
  '/api/bff/payments/status',
]);

const emailVerificationPagePaths = new Set([
  '/verify-email',
  '/register/verify-email',
]);

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');

  return atob(padded);
}

function encodeBase64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacSha256(value: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));

  return encodeBase64Url(signature);
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

type AccessState = {
  authenticated: boolean;
  fullAuthenticated: boolean;
  bootstrapAuthenticated: boolean;
  emailVerificationRequired: boolean;
  hasRefreshToken: boolean;
};

async function getAccessState(request: NextRequest): Promise<AccessState> {
  const token = request.cookies.get(accessCookieName)?.value;
  const hasRefreshToken = Boolean(request.cookies.get(refreshCookieName)?.value);

  if (!token) {
    return { authenticated: false, fullAuthenticated: false, bootstrapAuthenticated: false, emailVerificationRequired: false, hasRefreshToken };
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature) {
    return { authenticated: false, fullAuthenticated: false, bootstrapAuthenticated: false, emailVerificationRequired: false, hasRefreshToken };
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown; ev?: unknown; tg?: unknown; al?: unknown };

    if (typeof parsed.exp !== 'number' || parsed.exp <= Math.floor(Date.now() / 1000)) {
      return { authenticated: false, fullAuthenticated: false, bootstrapAuthenticated: false, emailVerificationRequired: false, hasRefreshToken };
    }

    const secret = process.env.WEB_JWT_SECRET;

    if (!secret) {
      return { authenticated: false, fullAuthenticated: false, bootstrapAuthenticated: false, emailVerificationRequired: false, hasRefreshToken };
    }

    const authenticated = safeEqual(signature, await hmacSha256(payload, secret));
    const assuranceLevel = parsed.al === "BOOTSTRAP" ? "BOOTSTRAP" : "FULL";

    return {
      authenticated,
      fullAuthenticated: authenticated && assuranceLevel === "FULL",
      bootstrapAuthenticated: authenticated && assuranceLevel === "BOOTSTRAP",
      emailVerificationRequired: authenticated && parsed.ev === false && parsed.tg !== true,
      hasRefreshToken,
    };
  } catch {
    return { authenticated: false, fullAuthenticated: false, bootstrapAuthenticated: false, emailVerificationRequired: false, hasRefreshToken };
  }
}

function isPublicPath(pathname: string) {
  return publicPagePaths.has(pathname)
    || publicApiPaths.has(pathname)
    || pathname.startsWith('/invite/');
}

function isInvitePath(pathname: string) {
  return pathname.startsWith('/invite/');
}

function isEmailVerificationAllowedPath(pathname: string) {
  return emailVerificationPagePaths.has(pathname);
}

function isBootstrapAllowedPath(pathname: string) {
  return (
    pathname === '/passkey/setup'
  );
}

function canonicalConfusableProtectedPath(pathname: string) {
  try {
    const decoded = decodeURIComponent(pathname);

    // Cyrillic small es (U+0441) is visually indistinguishable from the
    // ASCII "c" in an address bar. Preserve the session and repair this
    // observed legacy/bookmark typo instead of letting Next.js render a 404.
    if (decoded === '/\u0441abinet') {
      return '/cabinet';
    }
  } catch {
    // Malformed paths remain Next.js 404s; never guess a destination.
  }

  return undefined;
}

function safeRedirectTarget(request: NextRequest) {
  const target = request.nextUrl.pathname + request.nextUrl.search;

  if (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/register') {
    return '/cabinet';
  }

  return target;
}

function localRedirectUrl(request: NextRequest, target: string) {
  const resolved = new URL(target, request.nextUrl.origin);
  const url = request.nextUrl.clone();

  url.pathname = resolved.pathname;
  url.search = resolved.search;
  url.hash = resolved.hash;

  return url;
}

function loginRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('redirect_to', safeRedirectTarget(request));

  const response = NextResponse.redirect(url);
  response.cookies.delete(accessCookieName);
  response.cookies.delete(refreshCookieName);

  return response;
}

function authenticatedRedirect(request: NextRequest, emailVerificationRequired: boolean) {
  const redirectTo = safeRedirectPath(
    request.nextUrl.searchParams.get('redirect_to'),
  ) ?? '/cabinet';
  const target = emailVerificationRequired
    ? registrationEmailVerificationPath(redirectTo)
    : redirectTo;

  return NextResponse.redirect(localRedirectUrl(request, target));
}

function refreshSessionRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = sessionRefreshPath;
  url.search = '';
  const isAuthEntry = request.nextUrl.pathname === '/login'
    || request.nextUrl.pathname === '/register';
  const returnTo = isAuthEntry
    ? safeRedirectPath(request.nextUrl.searchParams.get('redirect_to')) ?? '/cabinet'
    : safeRedirectTarget(request);
  url.searchParams.set('return_to', returnTo);
  if (isAuthEntry) {
    const fallback = new URL(request.nextUrl.pathname, request.nextUrl.origin);
    fallback.searchParams.set('redirect_to', returnTo);
    url.searchParams.set('fallback_to', `${fallback.pathname}${fallback.search}`);
  }
  return NextResponse.redirect(url);
}

function requestMetadata(
  request: NextRequest,
  accessState: AccessState,
  security: RequestSecurityContext,
) {
  const { pathname } = request.nextUrl;

  return {
    method: request.method,
    pathname,
    isApi: pathname.startsWith('/api/'),
    authenticated: accessState.authenticated,
    accessAuthenticated: accessState.authenticated,
    fullAuthenticated: accessState.fullAuthenticated,
    bootstrapAuthenticated: accessState.bootstrapAuthenticated,
    hasRefreshToken: accessState.hasRefreshToken,
    emailVerificationRequired: accessState.emailVerificationRequired,
    requestId: security.requestId,
    traceId: security.traceId,
  };
}

function browserMutationGuard(request: NextRequest) {
  if (
    request.nextUrl.pathname === '/auth/telegram/callback'
    && request.method === 'POST'
  ) {
    return validateRequestSource({
      headers: request.headers,
      trustedAppUrl: process.env.NEXT_PUBLIC_APP_URL,
    });
  }

  if (request.nextUrl.pathname === '/auth/telegram/start') {
    if (!request.cookies.has(accessCookieName) && !request.cookies.has(refreshCookieName)) {
      return { ok: true } as const;
    }

    return validateRequestSource({
      headers: request.headers,
      trustedAppUrl: process.env.NEXT_PUBLIC_APP_URL,
    });
  }

  return { ok: true } as const;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const security = requestSecurityContext(request);
  const canonicalPath = canonicalConfusableProtectedPath(pathname);

  if (
    canonicalPath
    && (request.method === 'GET' || request.method === 'HEAD')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = canonicalPath;
    logger.warn("http_request_decision", {
      pathname,
      canonicalPath,
      action: "redirect_confusable_path",
      status: 307,
      requestId: security.requestId,
      traceId: security.traceId,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${pathname} -> 307 canonical protected path`,
    });
    return secureResponse(NextResponse.redirect(url), security);
  }

  const accessState = await getAccessState(request);
  // Edge middleware cannot validate the opaque database-backed refresh token.
  // Treat it as a session candidate for both pages and APIs and let the first
  // server handler validate it. Deleting it here on ordinary navigation would
  // destroy a valid session whenever the short-lived access cookie expires.
  const isAuthenticated = accessState.authenticated || accessState.hasRefreshToken;
  const isBootstrapAuthenticated = accessState.bootstrapAuthenticated && !accessState.fullAuthenticated;
  const metadata = requestMetadata(request, accessState, security);
  const isRoutineReadinessProbe = pathname === readinessInternalPath && request.method === 'GET';

  const logRequest = isRoutineReadinessProbe ? logger.debug : logger.info;
  logRequest("http_request_received", metadata, {
    category: "http",
    source: "http.access",
    message: `${request.method} ${pathname} received`,
  });

  const refreshableNavigation =
    (request.method === 'GET' || request.method === 'HEAD')
    && !pathname.startsWith('/api/')
    && !pathname.startsWith('/auth/')
    && (
      pathname === '/login'
      || pathname === '/register'
      || isInvitePath(pathname)
      || !isPublicPath(pathname)
    );

  if (
    refreshableNavigation
    && accessState.hasRefreshToken
    && !accessState.authenticated
  ) {
    logger.info("http_request_decision", {
      ...metadata,
      action: "redirect_session_refresh",
      status: 307,
      redirectTo: sessionRefreshPath,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${pathname} -> 307 session refresh`,
    });
    return secureResponse(refreshSessionRedirect(request), security);
  }

  if (isInvitePath(pathname) && (accessState.authenticated || isBootstrapAuthenticated)) {
    const redirectTo = isBootstrapAuthenticated
      ? passkeySetupPath('/tariffs')
      : accessState.emailVerificationRequired
        ? registrationEmailVerificationPath('/tariffs')
        : '/tariffs';
    const response = NextResponse.redirect(localRedirectUrl(request, redirectTo));
    response.cookies.delete(REFERRAL_ATTRIBUTION_COOKIE_NAME);
    return secureResponse(response, security);
  }

  if (
    (pathname === paymentReconciliationInternalPath && request.method === 'POST') ||
    (pathname === readinessInternalPath && request.method === 'GET') ||
    (pathname === metricsInternalPath && request.method === 'GET')
  ) {
    const logDecision = isRoutineReadinessProbe ? logger.debug : logger.info;
    logDecision("http_request_decision", {
      ...metadata,
      action: "allow_internal_service",
      status: 200,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${pathname} -> allow internal service`,
    });
    return continueRequest(security);
  }

  const csrfResult = browserMutationGuard(request);

  if (!csrfResult.ok) {
    logger.warn("http_request_decision", {
      ...metadata,
      action: "block_csrf",
      reason: csrfResult.reason,
      status: csrfResult.status,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${pathname} -> ${csrfResult.status} ${csrfResult.reason}`,
    });

    return secureResponse(NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Источник запроса не разрешён.' } },
      { status: csrfResult.status },
    ), security);
  }

  if (isPublicPath(pathname)) {
    if ((accessState.authenticated || isBootstrapAuthenticated) && (pathname === '/login' || pathname === '/register')) {
      const requestedRedirect = safeRedirectPath(
        request.nextUrl.searchParams.get('redirect_to'),
      ) ?? '/cabinet';
      const redirectTo = isBootstrapAuthenticated
        ? passkeySetupPath(requestedRedirect)
        : accessState.emailVerificationRequired
          ? registrationEmailVerificationPath(requestedRedirect)
          : requestedRedirect;
      logger.info("http_request_decision", {
        ...metadata,
        action: "redirect_authenticated_user",
        status: 307,
        redirectTo,
        emailVerificationRequired: accessState.emailVerificationRequired,
      }, {
        category: "http",
        source: "http.access",
        message: `${request.method} ${pathname} -> 307 redirect authenticated user`,
      });
      if (isBootstrapAuthenticated) {
        return secureResponse(
          NextResponse.redirect(localRedirectUrl(request, redirectTo)),
          security,
        );
      }

      return secureResponse(
        authenticatedRedirect(request, accessState.emailVerificationRequired),
        security,
      );
    }

    logger.info("http_request_decision", {
      ...metadata,
      action: "allow_public",
      status: 200,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${pathname} -> allow public`,
    });
    return continueRequest(security);
  }

  if (removedBrowserTransportPaths.has(pathname)) {
    return continueRequest(security);
  }

  // A BOOTSTRAP access token represents a deliberately restricted session.
  // Its refresh cookie is only a session candidate and must not promote it to
  // the general authenticated path before the passkey setup is completed.
  if (isAuthenticated && !isBootstrapAuthenticated) {
    if (accessState.emailVerificationRequired && !isEmailVerificationAllowedPath(pathname)) {
      if (pathname.startsWith('/api/')) {
        logger.warn("http_request_decision", {
          ...metadata,
          action: "block_email_unverified",
          status: 403,
        }, {
          category: "http",
          source: "http.access",
          message: `${request.method} ${pathname} -> 403 email not verified`,
        });
        return secureResponse(NextResponse.json(
          { error: { code: 'EMAIL_NOT_VERIFIED', message: 'Подтвердите e-mail, чтобы продолжить.' } },
          { status: 403 },
        ), security);
      }

      const redirectTarget = registrationEmailVerificationPath(
        safeRedirectTarget(request),
      );
      const url = localRedirectUrl(request, redirectTarget);

      logger.info("http_request_decision", {
        ...metadata,
        action: "redirect_email_unverified",
        status: 307,
        redirectTo: redirectTarget,
      }, {
        category: "http",
        source: "http.access",
        message: `${request.method} ${pathname} -> 307 email verification required`,
      });
      return secureResponse(NextResponse.redirect(url), security);
    }

    logger.info("http_request_decision", {
      ...metadata,
      action: "allow_authenticated",
      status: 200,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${pathname} -> allow authenticated`,
    });
    return continueRequest(security);
  }

  if (isBootstrapAuthenticated) {
    if (isBootstrapAllowedPath(pathname)) {
      logger.info("http_request_decision", {
        ...metadata,
        action: "allow_bootstrap",
        status: 200,
      }, {
        category: "http",
        source: "http.access",
        message: `${request.method} ${pathname} -> allow bootstrap`,
      });
      return continueRequest(security);
    }

    if (pathname.startsWith('/api/')) {
      logger.warn("http_request_decision", {
        ...metadata,
        action: "block_bootstrap",
        status: 403,
      }, {
        category: "http",
        source: "http.access",
        message: `${request.method} ${pathname} -> 403 passkey required`,
      });
      return secureResponse(NextResponse.json(
        { error: { code: 'PASSKEY_REQUIRED', message: 'Создайте ключ доступа, чтобы продолжить.' } },
        { status: 403 },
      ), security);
    }

    const redirectTarget = passkeySetupPath(safeRedirectTarget(request));
    const url = localRedirectUrl(request, redirectTarget);

    logger.info("http_request_decision", {
      ...metadata,
      action: "redirect_passkey_setup",
      status: 307,
      redirectTo: redirectTarget,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${pathname} -> 307 passkey setup`,
    });
    return secureResponse(NextResponse.redirect(url), security);
  }

  if (pathname.startsWith('/api/')) {
    logger.warn("http_request_decision", {
      ...metadata,
      action: "block_unauthorized",
      status: 401,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${pathname} -> 401 unauthorized`,
    });
    const response = NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Войдите в аккаунт, чтобы продолжить.' } },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
    // An anonymous request can still be in flight when a login response sets
    // fresh cookies. Do not let that older 401 erase the newly-created session.
    if (request.cookies.has(accessCookieName)) {
      response.cookies.delete(accessCookieName);
    }
    if (request.cookies.has(refreshCookieName)) {
      response.cookies.delete(refreshCookieName);
    }

    return secureResponse(response, security);
  }

  logger.info("http_request_decision", {
    ...metadata,
    action: "redirect_login",
    status: 307,
    redirectTo: "/login",
  }, {
    category: "http",
    source: "http.access",
    message: `${request.method} ${pathname} -> 307 login`,
  });
  return secureResponse(loginRedirect(request), security);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|map|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$).*)',
  ],
};
