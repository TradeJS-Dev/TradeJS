import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getProjectRoot = (): string => {
  const fromEnv = String(process.env.PROJECT_CWD || '').trim();
  return fromEnv ? path.resolve(fromEnv) : process.cwd();
};

const stripPngExtension = (value: string) => value.replace(/\.png$/i, '');

const isSafeScreenshotName = (value: string) =>
  /^[A-Za-z0-9_.-]+$/.test(value) && path.basename(value) === value;

const getScreenshotCandidates = (name: string) => {
  const projectRoot = getProjectRoot();
  const normalizedName = stripPngExtension(name);

  return [
    path.join(projectRoot, 'data', 'screenshots', `${normalizedName}.png`),
    path.join(projectRoot, 'public', 'screenshots', `${normalizedName}.png`),
    path.join(
      projectRoot,
      'apps',
      'app',
      'public',
      'screenshots',
      `${normalizedName}.png`,
    ),
  ];
};

interface Params {
  name: string;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<Params> },
) {
  const { name } = await params;

  if (!isSafeScreenshotName(name)) {
    return NextResponse.json(
      { error: 'Invalid screenshot name' },
      { status: 400 },
    );
  }

  try {
    for (const filePath of getScreenshotCandidates(name)) {
      try {
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
        continue;
      }
    }

    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to load screenshot' },
      { status: 500 },
    );
  }
}
