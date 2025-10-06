import { NextResponse } from 'next/server';
import { OrderLogData } from '@types';
import { getData } from '@utils/redis';
import { logger } from '@utils/logger';

const AREA = 'tests';

interface Params {
  name: string;
}

export const GET = async (_req: Request, { params }: { params: Params }) => {
  try {
    const { name } = params;

    if (!name) {
      return NextResponse.json(
        { error: 'Missing required parameter: name' },
        { status: 400 },
      );
    }

    const orderLog: OrderLogData = await getData(`${AREA}:${name}:orders`);

    return NextResponse.json({ orderLog });
  } catch (error) {
    logger.log('error', `Backtest order log error: %o`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
