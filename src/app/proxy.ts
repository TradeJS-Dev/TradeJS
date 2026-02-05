import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { getData, redisKeys } from '@utils/redis';

const SIGNIN_PATH = '/routes/signin';
const SCREENSHOT_API_PREFIX = '/api/files/screenshot';

const getRootToken = async (): Promise<string | null> => {
  const rootUser = await getData(redisKeys.user('root'), null);
  if (!rootUser || typeof rootUser !== 'object') return null;
  const record = rootUser as Record<string, unknown>;
  const token = record.token;
  return typeof token === 'string' ? token : null;
};

export const proxy = async (req: NextRequest) => {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith(SIGNIN_PATH) ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith(SCREENSHOT_API_PREFIX)
  ) {
    return NextResponse.next();
  }

  const queryToken = req.nextUrl.searchParams.get('token');
  if (queryToken) {
    const rootToken = await getRootToken();
    if (rootToken && queryToken === rootToken) {
      return NextResponse.next();
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
