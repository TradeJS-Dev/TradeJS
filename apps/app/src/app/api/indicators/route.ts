import { NextResponse } from 'next/server';
import {
  getPluginIndicatorCatalog,
  getPluginIndicatorRenderers,
} from '@tradejs/core/indicators';
import { ensureIndicatorPluginsLoaded } from '@tradejs/node/registry';
import { logger } from '@tradejs/infra/logger';

export const dynamic = 'force-dynamic';
const projectRoot =
  String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();

export const GET = async () => {
  try {
    await ensureIndicatorPluginsLoaded(projectRoot);
    const data = getPluginIndicatorCatalog(projectRoot);
    const renderers = getPluginIndicatorRenderers(projectRoot);
    return NextResponse.json({ data, renderers });
  } catch (error) {
    logger.log('error', 'Indicators catalog error: %o', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
};
