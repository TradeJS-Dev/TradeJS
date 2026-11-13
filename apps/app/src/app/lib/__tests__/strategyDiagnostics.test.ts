import { summarizeStrategyComparison } from '../strategyDiagnostics';

jest.mock('@tradejs/node/mcp', () => ({
  isMcpRecord: (value: unknown) =>
    value !== null && typeof value === 'object' && !Array.isArray(value),
  redactMcpJobLog: (value: string) => value,
}));
jest.mock('../mcp/artifacts', () => ({}));

it('connects a replay-only trade to runtime evidence without relying on JSON field order', () => {
  const timestamp = Date.UTC(2026, 0, 1);
  const trade = {
    symbol: 'BTCUSDT',
    strategy: 'Example',
    direction: 'long',
    timestamp,
    price: 100,
    pnl: 10,
    signalId: 'replay-1',
  };
  const result = summarizeStrategyComparison({
    deployment: { provider: 'bybit' },
    replay: {
      runtimeComparison: {
        byStrategy: {
          Example: { matched: 0, backtestOnly: 1, runtimeOnly: 0 },
        },
        backtestOnly: [trade],
        mismatchDrilldown: {
          backtestOnly: [
            {
              entry: { ...trade, costs: {} },
              classification: 'blocked',
              reason: 'Runtime evaluated the signal but skipped entry.',
              runtimeSignal: {
                signalId: 'live-1',
                timestamp,
                orderSkipReason: 'Risk limit reached',
              },
            },
          ],
        },
      },
    },
  });
  expect(result.cases).toMatchObject([
    {
      category: 'backtestOnly',
      replay: { price: 100, signalId: 'replay-1' },
      runtime: { signalId: 'live-1' },
      decision: 'Risk limit reached',
    },
  ]);
});
