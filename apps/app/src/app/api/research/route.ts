import { createReadStream } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import { getCurrentUserName } from '#app/lib/currentUser';
import {
  getResearchArtifact,
  getResearchStudy,
  isResearchLibraryOwner,
  listResearchStudies,
} from '#app/lib/researchLibrary';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const cacheHeaders = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const userName = await getCurrentUserName();
  if (!isResearchLibraryOwner(userName)) {
    return NextResponse.json(
      { error: 'Research is available to the project owner.' },
      {
        status: userName ? 403 : 401,
        headers: cacheHeaders,
      },
    );
  }
  const query = request.nextUrl.searchParams;
  const strategy = query.get('strategy');
  const study = query.get('study');
  const artifact = query.get('artifact');

  try {
    if (!strategy && !study && !artifact) {
      return NextResponse.json(
        { studies: await listResearchStudies() },
        { headers: cacheHeaders },
      );
    }
    if (strategy && study) {
      if (artifact) {
        const result = await getResearchArtifact(strategy, study, artifact);
        if (result) {
          const file = createReadStream(result.file);
          const chunks = file[Symbol.asyncIterator]();
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              const chunk = await chunks.next();
              if (chunk.done) controller.close();
              else controller.enqueue(chunk.value);
            },
            cancel() {
              file.destroy();
            },
          });
          return new NextResponse(body, {
            headers: {
              ...cacheHeaders,
              'Content-Type': result.contentType,
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy':
                "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
            },
          });
        }
      } else {
        const detail = await getResearchStudy(strategy, study);
        if (detail)
          return NextResponse.json({ detail }, { headers: cacheHeaders });
      }
    }
    return NextResponse.json(
      { error: 'Research item not found.' },
      { status: 404, headers: cacheHeaders },
    );
  } catch (error) {
    logger.error('Failed to read strategy research: %o', error);
    return NextResponse.json(
      { error: 'Could not load research.' },
      { status: 500, headers: cacheHeaders },
    );
  }
}
