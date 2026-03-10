import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

const getProjectRoot = (): string => {
  const fromEnv = String(process.env.PROJECT_CWD || '').trim();
  return fromEnv ? path.resolve(fromEnv) : process.cwd();
};

interface Params {
  name: string;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<Params> },
) {
  try {
    const { name } = await params;
    const filePath = path.join(
      getProjectRoot(),
      'data',
      'screenshots',
      `${name}.png`,
    );
    const file = await fs.readFile(filePath);

    const body = new Uint8Array(file);

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(file.byteLength),
        'Cache-Control': 'public, max-age=60, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
