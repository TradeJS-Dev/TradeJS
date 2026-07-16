import { NextResponse } from 'next/server';
import {
  initializeInstallation,
  isInstallationRequired,
} from '#app/lib/installation';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  const required = await isInstallationRequired();
  return NextResponse.json({ required });
};

export const POST = async (request: Request) => {
  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
    confirmPassword?: unknown;
  } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  const confirmPassword =
    typeof body?.confirmPassword === 'string' ? body.confirmPassword : '';

  if (password.length < 8) {
    return NextResponse.json(
      { error: 'Password must contain at least 8 characters' },
      { status: 400 },
    );
  }
  if (password.length > 256) {
    return NextResponse.json(
      { error: 'Password is too long' },
      { status: 400 },
    );
  }
  if (password !== confirmPassword) {
    return NextResponse.json(
      { error: 'Passwords do not match' },
      { status: 400 },
    );
  }

  const initialized = await initializeInstallation(password);
  if (!initialized) {
    return NextResponse.json(
      { error: 'TradeJS is already installed' },
      { status: 409 },
    );
  }

  return NextResponse.json({ userName: 'root' }, { status: 201 });
};
