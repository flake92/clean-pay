import { NextRequest, NextResponse } from 'next/server';

import { logger } from "@/backend/observability/logger";
import { validateRequestSource } from "@/backend/security/csrf";
import {
  passkeySetupPath,
  registrationEmailVerificationPath,
} from "@/shared/auth/account-setup-flow";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

const accessCookieName = 'clean_pay_access';
const refreshCookieName = 'clean_pay_refresh';

const paymentReconciliationInternalPath = '/api/internal/payments/reconcile';
const readinessInternalPath = '/api/internal/health/readiness';

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
  return publicPagePaths.has(pathname) || publicApiPaths.has(pathname);
}

function isEmailVerificationAllowedPath(pathname: string) {
  return emailVerificationPagePaths.has(pathname);
}

function isBootstrapAllowedPath(pathname: string) {
  return (
    pathname === '/passkey/setup'
  );
}

function safeRedirectTarget(request: NextRequest) {
  const target = request.nextUrl.pathname + request.nextUrl.search;

  if (target.startsWith('/login') || target.startsWith('/register')) {
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

function requestMetadata(request: NextRequest, accessState: AccessState) {
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
  };
}

function browserMutationGuard(request: NextRequest) {
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
  const accessState = await getAccessState(request);
  // Edge middleware cannot validate the opaque database-backed refresh token.
  // Treat it as a session candidate for both pages and APIs and let the first
  // server handler validate it. Deleting it here on ordinary navigation would
  // destroy a valid session whenever the short-lived access cookie expires.
  const isAuthenticated = accessState.authenticated || accessState.hasRefreshToken;
  const isBootstrapAuthenticated = accessState.bootstrapAuthenticated && !accessState.fullAuthenticated;
  const metadata = requestMetadata(request, accessState);
  const isRoutineReadinessProbe = pathname === readinessInternalPath && request.method === 'GET';

  const logRequest = isRoutineReadinessProbe ? logger.debug : logger.info;
  logRequest("http_request_received", metadata, {
    category: "http",
    source: "http.access",
    message: `${request.method} ${pathname} received`,
  });

  if (
    (pathname === paymentReconciliationInternalPath && request.method === 'POST') ||
    (pathname === readinessInternalPath && request.method === 'GET')
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
    return NextResponse.next();
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

    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Источник запроса не разрешён.' } },
      { status: csrfResult.status },
    );
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
        return NextResponse.redirect(localRedirectUrl(request, redirectTo));
      }

      return authenticatedRedirect(request, accessState.emailVerificationRequired);
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
    return NextResponse.next();
  }

  if (removedBrowserTransportPaths.has(pathname)) {
    return NextResponse.next();
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
        return NextResponse.json(
          { error: { code: 'EMAIL_NOT_VERIFIED', message: 'Подтвердите e-mail, чтобы продолжить.' } },
          { status: 403 },
        );
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
      return NextResponse.redirect(url);
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
    return NextResponse.next();
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
      return NextResponse.next();
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
      return NextResponse.json(
        { error: { code: 'PASSKEY_REQUIRED', message: 'Создайте ключ доступа, чтобы продолжить.' } },
        { status: 403 },
      );
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
    return NextResponse.redirect(url);
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

    return response;
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
  return loginRedirect(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|map|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$).*)',
  ],
};
