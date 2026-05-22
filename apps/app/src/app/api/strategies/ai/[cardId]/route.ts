import { NextResponse } from 'next/server';
import { delKey, redisKeys } from '@tradejs/infra/redis';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const userName = await getCurrentUserName();
  if (!userName) {
    return NextResponse.json({ deleted: false }, { status: 401 });
  }

  const { cardId } = await params;
  const deleted = await delKey(
    redisKeys.strategyChartCard(userName, 'ai', decodeURIComponent(cardId)),
  );

  return NextResponse.json({ deleted });
}
