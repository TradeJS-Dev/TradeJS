import { NextResponse } from 'next/server';
import {
  getPluginIndicatorCatalog,
  getPluginIndicatorRenderers,
} from '@tradejs/core/indicators';
import { ensureIndicatorPluginsLoaded } from '@tradejs/node/registry';
import { logger } from '@tradejs/infra/logger';

export const dynamic = 'force-dynamic';

export const GET = async () => {
  try {
    await ensureIndicatorPluginsLoaded();
    const data = getPluginIndicatorCatalog();
    const renderers = getPluginIndicatorRenderers();
    return NextResponse.json({ data, renderers });
  } catch (error) {
    logger.log('error', 'Indicators catalog error: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
