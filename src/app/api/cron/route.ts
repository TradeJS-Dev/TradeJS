import { NextResponse } from 'next/server';
import { runBot } from '@utils/bot';
import { BotResults } from '@types';

export const dynamic = 'force-dynamic';

const runBotLogic = async (): Promise<BotResults> => {
  return await runBot();
};

export const GET = async () => {
  try {
    const results = await runBotLogic();
    return NextResponse.json({ status: 'ok', dt: new Date(), results });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
