import { NextRequest, NextResponse } from 'next/server';

import { logger } from "@/backend/observability/logger";
import {
  accessCookieName,
  type AccessState,
  authenticatedEntryRedirectPolicy,
  authenticatedInviteRedirectPolicy,
  emailVerificationRedirectPolicy,
  getAccessState,
  passkeySetupRedirectPolicy,
  refreshCookieName,
  refreshSessionRedirectPolicy,
  safeRedirectTarget,
} from "@/shared/edge/proxy-auth-policy";
import { browserMutationPolicy } from "@/shared/edge/proxy-mutation-policy";
import {
  accessLogRouteTemplate,
  canonicalConfusableProtectedPath,
  isBootstrapAllowedPath,
  isEmailVerificationAllowedPath,
  isInternalServiceRequest,
  isInvitePath,
  isPublicPath,
  isRefreshableNavigation,
  isRemovedBrowserTransportPath,
  isRoutineReadinessProbe as matchesRoutineReadinessProbe,
  sessionRefreshPath,
} from "@/shared/edge/proxy-route-policy";
import {
  createProxyRequestSecurity,
  type ProxyRequestSecurity,
} from "@/shared/edge/proxy-security-policy";
import { REFERRAL_ATTRIBUTION_COOKIE_NAME } from "@/shared/domain/referrals";

function randomHex(byteLength: number) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function requestSecurityContext(request: NextRequest): ProxyRequestSecurity {
  const chatwootBaseUrl = process.env.CHATWOOT_BASE_URL?.trim();
  const chatwootConfigured = Boolean(
    chatwootBaseUrl
    && process.env.CHATWOOT_WEBSITE_TOKEN?.trim()
    && process.env.CHATWOOT_HMAC_TOKEN?.trim(),
  );
  return createProxyRequestSecurity({
    headers: request.headers,
    chatwootBaseUrl,
    chatwootConfigured,
    randomHex,
    randomUuid: () => crypto.randomUUID(),
  });
}

function secureResponse<T extends NextResponse>(
  response: T,
  context: ProxyRequestSecurity,
) {
  response.headers.set('content-security-policy', context.contentSecurityPolicy);
  response.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  response.headers.set('x-request-id', context.requestId);
  response.headers.set('x-clean-pay-trace-id', context.traceId);
  return response;
}

function continueRequest(context: ProxyRequestSecurity) {
  return secureResponse(NextResponse.next({
    request: { headers: context.requestHeaders },
  }), context);
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
  url.searchParams.set(
    'redirect_to',
    safeRedirectTarget(request.nextUrl.pathname, request.nextUrl.search),
  );

  const response = NextResponse.redirect(url);
  response.headers.set('cache-control', 'no-store');
  response.cookies.delete(accessCookieName);
  response.cookies.delete(refreshCookieName);

  return response;
}

function authenticatedRedirect(request: NextRequest, emailVerificationRequired: boolean) {
  const target = authenticatedEntryRedirectPolicy({
    requestedRedirect: request.nextUrl.searchParams.get('redirect_to'),
    bootstrapAuthenticated: false,
    emailVerificationRequired,
  });

  const response = NextResponse.redirect(localRedirectUrl(request, target));
  response.headers.set('cache-control', 'no-store');
  return response;
}

function refreshSessionRedirect(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = sessionRefreshPath;
  url.search = '';
  const { returnTo, fallbackTo } = refreshSessionRedirectPolicy({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    origin: request.nextUrl.origin,
    requestedRedirect: request.nextUrl.searchParams.get('redirect_to'),
  });
  url.searchParams.set('return_to', returnTo);
  if (fallbackTo) {
    url.searchParams.set('fallback_to', fallbackTo);
  }
  const response = NextResponse.redirect(url);
  response.headers.set('cache-control', 'no-store');
  return response;
}

function requestMetadata(
  request: NextRequest,
  accessState: AccessState,
  security: ProxyRequestSecurity,
  accessLogPathname: string,
) {
  const { pathname } = request.nextUrl;

  return {
    method: request.method,
    pathname: accessLogPathname,
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

async function browserMutationGuard(request: NextRequest) {
  return browserMutationPolicy({
    method: request.method,
    pathname: request.nextUrl.pathname,
    headers: request.headers,
    trustedAppUrl: process.env.NEXT_PUBLIC_APP_URL,
    hasAccessCookie: request.cookies.has(accessCookieName),
    hasRefreshCookie: request.cookies.has(refreshCookieName),
    cloneBody: () => request.clone().body,
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessLogPathname = accessLogRouteTemplate(pathname);
  const security = requestSecurityContext(request);
  const canonicalPath = canonicalConfusableProtectedPath(pathname);

  if (
    canonicalPath
    && (request.method === 'GET' || request.method === 'HEAD')
  ) {
    const url = request.nextUrl.clone();
    url.pathname = canonicalPath;
    logger.warn("http_request_decision", {
      pathname: accessLogPathname,
      canonicalPath: accessLogRouteTemplate(canonicalPath),
      action: "redirect_confusable_path",
      status: 307,
      requestId: security.requestId,
      traceId: security.traceId,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${accessLogPathname} -> 307 canonical protected path`,
    });
    return secureResponse(NextResponse.redirect(url), security);
  }

  const accessState = await getAccessState({
    token: request.cookies.get(accessCookieName)?.value,
    hasRefreshToken: Boolean(request.cookies.get(refreshCookieName)?.value),
    jwtSecret: () => process.env.WEB_JWT_SECRET,
  });
  // Edge middleware cannot validate the opaque database-backed refresh token.
  // Treat it as a session candidate for both pages and APIs and let the first
  // server handler validate it. Deleting it here on ordinary navigation would
  // destroy a valid session whenever the short-lived access cookie expires.
  const isAuthenticated = accessState.authenticated || accessState.hasRefreshToken;
  const isBootstrapAuthenticated = accessState.bootstrapAuthenticated && !accessState.fullAuthenticated;
  const metadata = requestMetadata(request, accessState, security, accessLogPathname);
  const isRoutineReadinessProbe = matchesRoutineReadinessProbe(pathname, request.method);

  const logRequest = isRoutineReadinessProbe ? logger.debug : logger.info;
  logRequest("http_request_received", metadata, {
    category: "http",
    source: "http.access",
    message: `${request.method} ${accessLogPathname} received`,
  });

  const refreshableNavigation = isRefreshableNavigation(pathname, request.method);

  if (
    refreshableNavigation
    && accessState.hasRefreshToken
    && !accessState.authenticated
  ) {
    logger.info("http_request_decision", {
      ...metadata,
      action: "redirect_session_refresh",
      status: 307,
      redirectTo: accessLogRouteTemplate(sessionRefreshPath),
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${accessLogPathname} -> 307 session refresh`,
    });
    return secureResponse(refreshSessionRedirect(request), security);
  }

  if (isInvitePath(pathname) && (accessState.authenticated || isBootstrapAuthenticated)) {
    const redirectTo = authenticatedInviteRedirectPolicy({
      bootstrapAuthenticated: isBootstrapAuthenticated,
      emailVerificationRequired: accessState.emailVerificationRequired,
    });
    const response = NextResponse.redirect(localRedirectUrl(request, redirectTo));
    response.cookies.delete(REFERRAL_ATTRIBUTION_COOKIE_NAME);
    return secureResponse(response, security);
  }

  if (isInternalServiceRequest(pathname, request.method)) {
    const logDecision = isRoutineReadinessProbe ? logger.debug : logger.info;
    logDecision("http_request_decision", {
      ...metadata,
      action: "allow_internal_service",
      status: 200,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${accessLogPathname} -> allow internal service`,
    });
    return continueRequest(security);
  }

  const csrfResult = await browserMutationGuard(request);

  if (!csrfResult.ok) {
    const oversized = csrfResult.status === 413;
    logger.warn("http_request_decision", {
      ...metadata,
      action: oversized ? "block_oversized_mutation" : "block_csrf",
      reason: csrfResult.reason,
      status: csrfResult.status,
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${accessLogPathname} -> ${csrfResult.status} ${csrfResult.reason}`,
    });

    return secureResponse(NextResponse.json(
      {
        error: oversized
          ? { code: 'PAYLOAD_TOO_LARGE', message: 'Размер запроса превышает допустимый предел.' }
          : { code: 'FORBIDDEN', message: 'Источник запроса не разрешён.' },
      },
      { status: csrfResult.status },
    ), security);
  }

  if (isPublicPath(pathname)) {
    if ((accessState.authenticated || isBootstrapAuthenticated) && (pathname === '/login' || pathname === '/register')) {
      const redirectTo = authenticatedEntryRedirectPolicy({
        requestedRedirect: request.nextUrl.searchParams.get('redirect_to'),
        bootstrapAuthenticated: isBootstrapAuthenticated,
        emailVerificationRequired: accessState.emailVerificationRequired,
      });
      logger.info("http_request_decision", {
        ...metadata,
        action: "redirect_authenticated_user",
        status: 307,
        redirectTo: accessLogRouteTemplate(redirectTo),
        emailVerificationRequired: accessState.emailVerificationRequired,
      }, {
        category: "http",
        source: "http.access",
        message: `${request.method} ${accessLogPathname} -> 307 redirect authenticated user`,
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
      message: `${request.method} ${accessLogPathname} -> allow public`,
    });
    return continueRequest(security);
  }

  if (isRemovedBrowserTransportPath(pathname)) {
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
          message: `${request.method} ${accessLogPathname} -> 403 email not verified`,
        });
        return secureResponse(NextResponse.json(
          { error: { code: 'EMAIL_NOT_VERIFIED', message: 'Подтвердите e-mail, чтобы продолжить.' } },
          { status: 403 },
        ), security);
      }

      const redirectTarget = emailVerificationRedirectPolicy(
        request.nextUrl.pathname,
        request.nextUrl.search,
      );
      const url = localRedirectUrl(request, redirectTarget);

      logger.info("http_request_decision", {
        ...metadata,
        action: "redirect_email_unverified",
        status: 307,
        redirectTo: accessLogRouteTemplate(redirectTarget),
      }, {
        category: "http",
        source: "http.access",
        message: `${request.method} ${accessLogPathname} -> 307 email verification required`,
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
      message: `${request.method} ${accessLogPathname} -> allow authenticated`,
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
        message: `${request.method} ${accessLogPathname} -> allow bootstrap`,
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
        message: `${request.method} ${accessLogPathname} -> 403 passkey required`,
      });
      return secureResponse(NextResponse.json(
        { error: { code: 'PASSKEY_REQUIRED', message: 'Создайте ключ доступа, чтобы продолжить.' } },
        { status: 403 },
      ), security);
    }

    const redirectTarget = passkeySetupRedirectPolicy(
      request.nextUrl.pathname,
      request.nextUrl.search,
    );
    const url = localRedirectUrl(request, redirectTarget);

    logger.info("http_request_decision", {
      ...metadata,
      action: "redirect_passkey_setup",
      status: 307,
      redirectTo: accessLogRouteTemplate(redirectTarget),
    }, {
      category: "http",
      source: "http.access",
      message: `${request.method} ${accessLogPathname} -> 307 passkey setup`,
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
      message: `${request.method} ${accessLogPathname} -> 401 unauthorized`,
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
    redirectTo: accessLogRouteTemplate("/login"),
  }, {
    category: "http",
    source: "http.access",
    message: `${request.method} ${accessLogPathname} -> 307 login`,
  });
  return secureResponse(loginRedirect(request), security);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|map|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$).*)',
  ],
};
