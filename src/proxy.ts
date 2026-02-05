import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { encode, getToken } from 'next-auth/jwt';
import { getData, getKeys, redisKeys } from '@utils/redis';

const SIGNIN_PATH = '/routes/signin';
const SCREENSHOT_API_PREFIX = '/api/files/screenshot';
const SESSION_COOKIE_NAME = 'authjs.session-token';
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;
const PUBLIC_FILE_RE = /\.(?:png|jpg|jpeg|webp|gif|svg|ico|txt|xml|json|map)$/i;

const getRootToken = async (): Promise<string | null> => {
  const rootUser = await getData(redisKeys.user('root'), null);
  if (!rootUser || typeof rootUser !== 'object') return null;
  const record = rootUser as Record<string, unknown>;
  const token = record.token;
  return typeof token === 'string' ? token : null;
};

const findUserByToken = async (token: string): Promise<string | null> => {
  const keys = await getKeys(redisKeys.users());
  for (const key of keys) {
    const user = await getData(key, null);
    if (!user || typeof user !== 'object') continue;
    const record = user as Record<string, unknown>;
    if (record.token !== token) continue;
    const userName =
      typeof record.userName === 'string'
        ? record.userName
        : key.slice(redisKeys.users().length);
    if (userName) return userName;
  }
  return null;
};

const issueSession = async (
  req: NextRequest,
  userName: string,
  response: NextResponse,
) => {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return response;

  const secure = req.nextUrl.protocol === 'https:';
  const jwt = await encode({
    token: { id: userName, name: userName },
    secret,
    salt: SESSION_COOKIE_NAME,
    maxAge: SESSION_MAX_AGE,
  });

  response.cookies.set(SESSION_COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: SESSION_MAX_AGE,
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
    PUBLIC_FILE_RE.test(pathname)
  ) {
    return NextResponse.next();
  }

  const queryToken = req.nextUrl.searchParams.get('token');
  if (queryToken) {
    const rootToken = await getRootToken();
    if (rootToken && queryToken === rootToken) {
      const cleaned = new URL(req.url);
      cleaned.searchParams.delete('token');
      const res =
        req.method === 'GET' && !pathname.startsWith('/api')
          ? NextResponse.redirect(cleaned)
          : NextResponse.next();
      return issueSession(req, 'root', res);
    }

    const userName = await findUserByToken(queryToken);
    if (userName) {
      const cleaned = new URL(req.url);
      cleaned.searchParams.delete('token');
      const res =
        req.method === 'GET' && !pathname.startsWith('/api')
          ? NextResponse.redirect(cleaned)
          : NextResponse.next();
      return issueSession(req, userName, res);
    }
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  const token = await getToken({ req, secret });

  if (!token) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const signInUrl = new URL(SIGNIN_PATH, req.url);
    signInUrl.searchParams.set('callbackUrl', req.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
};

export const config = {
  matcher: ['/:path*'],
};
