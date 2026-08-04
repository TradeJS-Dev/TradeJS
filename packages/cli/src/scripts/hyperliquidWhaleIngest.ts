import { runHyperliquidWhaleStream } from '../lib/hyperliquidWhaleStream';

export const main = async () => {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await runHyperliquidWhaleStream({
      signal: controller.signal,
      log: console.log,
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
};
