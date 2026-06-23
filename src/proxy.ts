import { NextRequest, NextResponse } from 'next/server';

const accessCookieName = 'clean_pay_access';

const publicPagePaths = new Set([
  '/login',
  '/register',
  '/auth/telegram/start',
  '/auth/telegram/callback',
]);

const publicApiPaths = new Set([
  '/api/health',
  '/api/bff/auth/login',
  '/api/bff/auth/register',
  '/api/bff/auth/logout',
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
  emailVerificationRequired: boolean;
};

async function getAccessState(request: NextRequest): Promise<AccessState> {
  const token = request.cookies.get(accessCookieName)?.value;

  if (!token) {
    return { authenticated: false, emailVerificationRequired: false };
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature) {
    return { authenticated: false, emailVerificationRequired: false };
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown; ev?: unknown; tg?: unknown };

    if (typeof parsed.exp !== 'number' || parsed.exp <= Math.floor(Date.now() / 1000)) {
      return { authenticated: false, emailVerificationRequired: false };
    }

    if (signature === 'mock') {
      const authenticated = process.env.CLEAN_PAY_MOCK_MODE === '1';

      return { authenticated, emailVerificationRequired: false };
    }

    const secret = process.env.WEB_JWT_SECRET;

    if (!secret) {
      return { authenticated: false, emailVerificationRequired: false };
    }

    const authenticated = safeEqual(signature, await hmacSha256(payload, secret));

    return {
      authenticated,
      emailVerificationRequired: authenticated && parsed.ev === false && parsed.tg !== true,
    };
  } catch {
    return { authenticated: false, emailVerificationRequired: false };
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

  return NextResponse.redirect(url);
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const accessState = await getAccessState(request);
  const isAuthenticated = accessState.authenticated;

  if (isPublicPath(pathname)) {
    if (isAuthenticated && (pathname === '/login' || pathname === '/register')) {
      return authenticatedRedirect(request, accessState.emailVerificationRequired);
    }

    return NextResponse.next();
  }

  if (isAuthenticated) {
    if (accessState.emailVerificationRequired && !isEmailVerificationAllowedPath(pathname)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: { code: 'EMAIL_NOT_VERIFIED', message: 'Подтвердите e-mail, чтобы продолжить.' } },
          { status: 403 },
        );
      }

      const url = request.nextUrl.clone();
      url.pathname = '/register/verify-email';
      url.search = '';

      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Войдите в аккаунт, чтобы продолжить.' } },
      { status: 401 },
    );
  }

  return loginRedirect(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|map|svg|png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$).*)',
  ],
};
