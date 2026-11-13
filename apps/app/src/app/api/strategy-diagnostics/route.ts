import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@tradejs/infra/logger';
import { getCurrentUserName } from '#app/lib/currentUser';
import { INSTALL_USER_NAME } from '#app/lib/installation';
import {
  listStrategyDiagnostics,
  readStrategyDiagnostic,
} from '#app/lib/strategyDiagnostics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });

export async function GET(request: NextRequest) {
  const user = await getCurrentUserName();
  if (user !== INSTALL_USER_NAME)
    return reply({ error: 'Access denied.' }, user ? 403 : 401);
  const id = request.nextUrl.searchParams.get('report');
  if (id !== null && !/^[a-f0-9]{64}$/.test(id))
    return reply({ error: 'Invalid report.' }, 400);
  try {
    if (id) return reply(await readStrategyDiagnostic(user, id));
    const reports = await listStrategyDiagnostics(user);
    return reply({
      items: reports.items.map(({ id, deploymentId, window, artifactId }) => ({
        id,
        deploymentId,
        window,
        label: typeof artifactId === 'string' ? artifactId : id.slice(0, 8),
      })),
      truncated: reports.truncated,
    });
  } catch (error) {
    logger.error(
      'Could not load strategy diagnostics: %s',
      error instanceof Error ? error.message : String(error),
    );
    return reply(
      {
        error: id
          ? 'The report is unavailable.'
          : 'Could not load diagnostic reports.',
      },
      id ? 404 : 503,
    );
  }
}
