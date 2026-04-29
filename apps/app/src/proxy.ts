import { NextResponse, type NextRequest } from 'next/server';
import { encode, getToken } from 'next-auth/jwt';
import { consumeScreenshotSessionToken } from '@tradejs/infra/redis';

const SIGNIN_PATH = '/routes/signin';
const SCREENSHOT_API_PREFIX = '/api/files/screenshot';
const SCREENSHOT_SESSION_QUERY_PARAM = 'screenshotToken';
const SESSION_COOKIE_NAME = 'authjs.session-token';
const SECURE_SESSION_COOKIE_NAME = '__Secure-authjs.session-token';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const PUBLIC_FILE_RE = /\.(?:png|jpg|jpeg|webp|gif|svg|ico|txt|xml|map)$/i;

const isSecureRequest = (req: NextRequest) => {
  if (req.nextUrl.protocol === 'https:') return true;
  const forwarded = req.headers.get('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim() === 'https';
  const nextAuthUrl = process.env.NEXTAUTH_URL;
  return typeof nextAuthUrl === 'string' && nextAuthUrl.startsWith('https://');
};

const issueSession = async (
  req: NextRequest,
  userName: string,
  response: NextResponse,
  maxAge = SESSION_MAX_AGE,
) => {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return response;

  const secure = isSecureRequest(req);
  const cookieName = secure ? SECURE_SESSION_COOKIE_NAME : SESSION_COOKIE_NAME;
  const jwt = await encode({
    token: { id: userName, name: userName },
    secret,
    salt: cookieName,
    maxAge,
  });

  response.cookies.set(cookieName, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge,
  });

  return response;
};

export const proxy = async (req: NextRequest) => {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith(SIGNIN_PATH) ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith(SCREENSHOT_API_PREFIX) ||
    (!pathname.startsWith('/api') && PUBLIC_FILE_RE.test(pathname))
  ) {
    return NextResponse.next();
  }

  const screenshotToken = req.nextUrl.searchParams.get(
    SCREENSHOT_SESSION_QUERY_PARAM,
  );
  if (
    screenshotToken &&
    req.method === 'GET' &&
    pathname.startsWith('/routes/dashboard/')
  ) {
    const userName = await consumeScreenshotSessionToken(screenshotToken);
    if (userName) {
      const cleaned = new URL(req.url);
      cleaned.searchParams.delete(SCREENSHOT_SESSION_QUERY_PARAM);
      return issueSession(
        req,
        userName,
        NextResponse.redirect(cleaned),
        15 * 60,
      );
    }
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const token = await getToken({
    req,
    secret,
    secureCookie: isSecureRequest(req),
  });

  if (!token) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const signInUrl = new URL(SIGNIN_PATH, req.url);
    const nextAuthBase = process.env.NEXTAUTH_URL;
    const currentUrl = new URL(req.url);
    const callbackUrl = nextAuthBase
      ? new URL(
          `${currentUrl.pathname}${currentUrl.search}`,
          nextAuthBase,
        ).toString()
      : req.url;
    signInUrl.searchParams.set('callbackUrl', callbackUrl);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
};

export const config = {
  matcher: ['/:path*'],
};
