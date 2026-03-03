import { NextResponse } from 'next/server';
import { getPluginIndicatorCatalog } from '@tradejs/core/indicators';
import { ensureIndicatorPluginsLoaded } from '@tradejs/core/strategy';
import { logger } from '@utils/logger';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    await ensureIndicatorPluginsLoaded();
    const data = getPluginIndicatorCatalog();
    return NextResponse.json({ data });
  } catch (error) {
    logger.log('error', 'Indicators catalog error: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
