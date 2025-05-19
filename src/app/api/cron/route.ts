import { NextResponse } from 'next/server';
import { runBot } from '@utils/bot';

const runBotLogic = async (): Promise<void> => {
  await runBot();
  console.log('Cron task running at', new Date());
};

export const GET = async () => {
  try {
    await runBotLogic();
    return NextResponse.json({ status: 'ok', dt: new Date() });
  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
