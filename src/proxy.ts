import { NextRequest, NextResponse } from 'next/server';

import { logger } from "@/backend/observability/logger";
import { validateMutationRequest, validateRequestSource } from "@/backend/security/csrf";

const accessCookieName = 'clean_pay_access';
const refreshCookieName = 'clean_pay_refresh';

const bodylessPostMutationPaths = new Set([
  '/api/logout',
  '/api/bff/auth/logout',
  '/api/bff/auth/passkey/login/options',
  '/api/bff/auth/passkey/register/options',
  '/api/bff/subscription/reissue',
]);

const passkeyCredentialPathPrefix = '/api/bff/auth/passkey/credentials/';
const subscriptionDevicePathPrefix = '/api/bff/subscription/devices/';
const paymentReconciliationInternalPath = '/api/internal/payments/reconcile';

function isSingleSegmentPath(pathname: string, prefix: string) {
  const suffix = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';

  return suffix.length > 0 && !suffix.includes('/');
}

function isBodylessMutation(method: string, pathname: string) {
  return (
    (method === 'POST' && bodylessPostMutationPaths.has(pathname)) ||
    (method === 'DELETE' && pathname === '/api/bff/subscription/devices') ||
    (method === 'DELETE' && isSingleSegmentPath(pathname, passkeyCredentialPathPrefix)) ||
    (method === 'DELETE' && isSingleSegmentPath(pathname, subscriptionDevicePathPrefix))
  );
}

const publicPagePaths = new Set([
  '/manifest.webmanifest',
  '/install',
  '/offline',
  '/login',
  '/register',
  '/auth/telegram/start',
  '/auth/telegram/callback',
  '/auth/telegram/webapp',
]);

const publicApiPaths = new Set([
  '/api/health',
  '/api/health/liveness',
  '/api/health/readiness',
  '/api/bff/auth/identify',
  '/api/bff/auth/login',
  '/api/bff/auth/register',
  '/api/bff/auth/telegram/webapp',
  '/api/bff/auth/logout',
  '/api/bff/auth/passkey/login/options',
  '/api/bff/auth/passkey/login/verify',
  '/api/bff/plans/public',
  '/api/logout',
]);

const emailVerificationPagePaths = new Set([
  '/verify-email',
  '/register/verify-email',
]);

const emailVerificationApiPrefixes = [
  '/api/bff/auth/email/',
];

const emailVerificationApiPaths = new Set([
  '/api/bff/auth/logout',
  '/api/logout',
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
  return (
    emailVerificationPagePaths.has(pathname) ||
    emailVerificationApiPaths.has(pathname) ||
    emailVerificationApiPrefixes.some((prefix) => pathname.startsWith(prefix))
  );
}

function isBootstrapAllowedPath(pathname: string) {
  return (
    pathname === '/passkey/setup' ||
    pathname === '/api/bff/auth/logout' ||
    pathname === '/api/logout' ||
    pathname.startsWith('/api/bff/auth/passkey/')
  );
}

function safeRedirectTarget(request: NextRequest) {
  const target = request.nextUrl.pathname + request.nextUrl.search;

  if (target.startsWith('/login') || target.startsWith('/register')) {
    return '/cabinet';
  }

  return target;
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
  const redirectTo = request.nextUrl.searchParams.get('redirect_to');
  const url = request.nextUrl.clone();

  url.pathname = emailVerificationRequired
    ? '/register/verify-email'
    : redirectTo?.startsWith('/') && !redirectTo.startsWith('//')
    ? redirectTo
    : '/cabinet';
  url.search = '';

  return NextResponse.redirect(url);
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

  const isProtectedMutationPath =
    request.nextUrl.pathname.startsWith('/api/bff/') ||
    request.nextUrl.pathname === '/api/logout' ||
    request.nextUrl.pathname === '/auth/telegram/callback';

  if (!isProtectedMutationPath) {
    return { ok: true } as const;
  }

  return validateMutationRequest({
    method: request.method,
    headers: request.headers,
    trustedAppUrl: process.env.NEXT_PUBLIC_APP_URL,
    requireJson: !isBodylessMutation(request.method.toUpperCase(), request.nextUrl.pathname),
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessState = await getAccessState(request);
  const isApi = pathname.startsWith('/api/');
  const isAuthenticated = accessState.authenticated || (isApi && accessState.hasRefreshToken);
  const isBootstrapAuthenticated = accessState.bootstrapAuthenticated && !accessState.fullAuthenticated;
  const metadata = requestMetadata(request, accessState);

  logger.info("http_request_received", metadata, {
    category: "http",
    source: "http.access",
    message: `${request.method} ${pathname} received`,
  });

  if (
    pathname === paymentReconciliationInternalPath &&
    request.method === 'POST'
  ) {
    logger.info("http_request_decision", {
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
      csrfResult.reason === "unsupported_media_type"
        ? { error: { code: 'VALIDATION_ERROR', message: 'Для этого запроса требуется application/json.' } }
        : { error: { code: 'FORBIDDEN', message: 'Источник запроса не разрешён.' } },
      { status: csrfResult.status },
    );
  }

  if (isPublicPath(pathname)) {
    if ((accessState.authenticated || isBootstrapAuthenticated) && (pathname === '/login' || pathname === '/register')) {
      const redirectTo = isBootstrapAuthenticated
        ? "/passkey/setup"
        : accessState.emailVerificationRequired
          ? "/register/verify-email"
          : "/cabinet";
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
        const url = request.nextUrl.clone();
        url.pathname = "/passkey/setup";
        url.search = "";
        return NextResponse.redirect(url);
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

  if (isAuthenticated) {
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

      const url = request.nextUrl.clone();
      url.pathname = '/register/verify-email';
      url.search = '';

      logger.info("http_request_decision", {
        ...metadata,
        action: "redirect_email_unverified",
        status: 307,
        redirectTo: "/register/verify-email",
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

    const url = request.nextUrl.clone();
    url.pathname = '/passkey/setup';
    url.search = '';

    logger.info("http_request_decision", {
      ...metadata,
      action: "redirect_passkey_setup",
      status: 307,
      redirectTo: "/passkey/setup",
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
      { status: 401 },
    );
    response.cookies.delete(accessCookieName);
    response.cookies.delete(refreshCookieName);

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
