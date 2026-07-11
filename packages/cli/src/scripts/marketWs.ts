import { startMarketWsGateway } from '../lib/marketData/marketWsGateway';

export const main = async () => {
  const gateway = await startMarketWsGateway();
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await new Promise<void>((resolve) =>
    abortController.signal.addEventListener('abort', () => resolve(), {
      once: true,
    }),
  );
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  await gateway.close();
};
