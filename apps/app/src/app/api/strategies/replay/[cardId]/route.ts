import { NextResponse } from 'next/server';
import { delKey, redisKeys } from '@tradejs/infra/redis';
import { getCurrentUserName } from '#app/lib/currentUser';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ cardId: string }> },
) {
  const userName = (await getCurrentUserName()) || 'root';
  const { cardId } = await params;
  const deleted = await delKey(
    redisKeys.strategyChartCard(userName, 'replay', decodeURIComponent(cardId)),
  );

  return NextResponse.json({ deleted });
}
