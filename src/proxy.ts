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

async function hasUsableAccessCookie(request: NextRequest) {
  const token = request.cookies.get(accessCookieName)?.value;

  if (!token) {
    return false;
  }

  const [payload, signature] = token.split('.');

  if (!payload || !signature) {
    return false;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as { exp?: unknown };

    if (typeof parsed.exp !== 'number' || parsed.exp <= Math.floor(Date.now() / 1000)) {
      return false;
    }

    if (signature === 'mock') {
      return process.env.CLEAN_PAY_MOCK_MODE === '1';
    }

    const secret = process.env.WEB_JWT_SECRET;

    if (!secret) {
      return false;
    }

    return safeEqual(signature, await hmacSha256(payload, secret));
  } catch {
    return false;
  }
}

function isPublicPath(pathname: string) {
  return publicPagePaths.has(pathname) || publicApiPaths.has(pathname);
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

function authenticatedRedirect(request: NextRequest) {
  const redirectTo = request.nextUrl.searchParams.get('redirect_to');
  const url = request.nextUrl.clone();

  url.pathname = redirectTo?.startsWith('/') && !redirectTo.startsWith('//')
    ? redirectTo
    : '/cabinet';
  url.search = '';

  return NextResponse.redirect(url);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthenticated = await hasUsableAccessCookie(request);

  if (isPublicPath(pathname)) {
    if (isAuthenticated && (pathname === '/login' || pathname === '/register')) {
      return authenticatedRedirect(request);
    }

    return NextResponse.next();
  }

  if (isAuthenticated) {
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
