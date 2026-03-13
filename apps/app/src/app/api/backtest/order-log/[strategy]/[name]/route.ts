'use server';

import { NextResponse } from 'next/server';
import { OrderLogData } from '@tradejs/types';
import { getData, logger, redisKeys } from '@tradejs/infra';
import { auth } from '@app/auth';

interface Params {
  strategy: string;
  name: string;
}

export const GET = async (
  _req: Request,
  { params }: { params: Promise<Params> },
) => {
  try {
    const { name, strategy } = await params;

    if (!name || !strategy) {
      return NextResponse.json(
        { error: 'Missing required parameter: name/strategy' },
        { status: 400 },
      );
    }

    const session = await auth();
    const userName = session?.user?.id || session?.user?.name;

    if (!userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const orderLog: OrderLogData = await getData(
      redisKeys.testOrders(userName, strategy, name),
    );

    return NextResponse.json({ orderLog });
  } catch (error) {
    logger.log('error', `Backtest order log error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
