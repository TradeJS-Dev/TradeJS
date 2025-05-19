import { NextResponse } from 'next/server';
import { runBot } from '@utils/bot';
import { BotResults } from '@types';
import { logger } from '@utils/logger';

export const dynamic = 'force-dynamic';

const runBotLogic = async (): Promise<BotResults> => {
  return await runBot();
};

export const GET = async () => {
  try {
    const results = await runBotLogic();
    return NextResponse.json({ status: 'ok', dt: new Date(), results });
  } catch (error) {
    logger.log('error', `Cron error: %s`, error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
