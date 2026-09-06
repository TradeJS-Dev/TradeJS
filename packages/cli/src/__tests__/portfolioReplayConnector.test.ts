import { round } from '@tradejs/core/math';
import {
  BACKTEST_BASE_SLIPPAGE_BPS,
  FEE_PERCENT,
  INITIAL_BACKTEST_AMOUNT,
} from '@tradejs/core/constants';
import { calculateEffectiveSlippageBps } from '@tradejs/core/trade';
import { createPortfolioReplayConnector } from '../lib/replay/portfolioReplayConnector';

describe('portfolio replay connector', () => {
  const backtestSlippageRate =
    calculateEffectiveSlippageBps({
      baseSlippageBps: BACKTEST_BASE_SLIPPAGE_BPS,
    }) / 10_000;
  const executionPrice = (
    price: number,
    direction: 'LONG' | 'SHORT',
    stage: 'entry' | 'exit',
  ) => {
    const sign =
      direction === 'LONG'
        ? stage === 'entry'
          ? 1
          : -1
        : stage === 'entry'
          ? -1
          : 1;
    return price * (1 + sign * backtestSlippageRate);
  };
  const fee = (price: number, qty = 1) => price * qty * FEE_PERCENT;
  const openProfit = (price: number, direction: 'LONG' | 'SHORT', qty = 1) =>
    -fee(executionPrice(price, direction, 'entry'), qty);
  const exitProfit = ({
    entryPrice,
    exitPrice,
    direction,
    qty = 1,
  }: {
    entryPrice: number;
    exitPrice: number;
    direction: 'LONG' | 'SHORT';
    qty?: number;
  }) => {
    const actualEntryPrice = executionPrice(entryPrice, direction, 'entry');
    const actualExitPrice = executionPrice(exitPrice, direction, 'exit');
    const grossProfit =
      direction === 'LONG'
        ? (actualExitPrice - actualEntryPrice) * qty
        : (actualEntryPrice - actualExitPrice) * qty;
    return grossProfit - fee(actualExitPrice, qty);
  };

  const baseConnector = {
    kline: jest.fn(),
    getState: jest.fn(async () => ({})),
    setState: jest.fn(async () => undefined),
    getPosition: jest.fn(),
    getPositions: jest.fn(),
    placeOrder: jest.fn(),
    setTakeProfits: jest.fn(),
    setStopLoss: jest.fn(),
    closePosition: jest.fn(),
    getTickers: jest.fn(async () => []),
  } as any;

  it('marks itself as a replay test connector for parity order execution', () => {
    const connector = createPortfolioReplayConnector(baseConnector);

    expect(connector.__tradejsReplayConnector).toBe(true);
    expect(connector.__tradejsTestConnector).toBe(true);
  });

  it('applies effective backtest slippage adversely to long and short entry/exit prices', async () => {
    const connector = createPortfolioReplayConnector(baseConnector);

    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        strategy: 'TrendLine',
      } as any,
    });
    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'SHORT',
      signal: {
        strategy: 'TrendShift',
      } as any,
    });
    await connector.closePosition({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 110,
      timestamp: 2,
      direction: 'LONG',
    } as any);
    await connector.closePosition({
      symbol: 'ETHUSDT',
      qty: 1,
      price: 90,
      timestamp: 2,
      direction: 'SHORT',
    } as any);

    const artifacts = connector.getReplayArtifacts();
    expect(artifacts.orderLog[0]).toEqual(
      expect.objectContaining({
        type: 'OPEN_LONG',
        profit: -0.1,
      }),
    );
    expect(artifacts.orderLog[0].price).toBeCloseTo(
      100 * (1 + backtestSlippageRate),
    );
    expect(artifacts.orderLog[1]).toEqual(
      expect.objectContaining({
        type: 'OPEN_SHORT',
        profit: -0.1,
      }),
    );
    expect(artifacts.orderLog[1].price).toBeCloseTo(
      100 * (1 - backtestSlippageRate),
    );
    expect(artifacts.orderLog[2]).toEqual(
      expect.objectContaining({
        type: 'CLOSE_LONG',
        profit: round(
          exitProfit({ entryPrice: 100, exitPrice: 110, direction: 'LONG' }),
        ),
      }),
    );
    expect(artifacts.orderLog[2].price).toBeCloseTo(
      110 * (1 - backtestSlippageRate),
    );
    expect(artifacts.orderLog[3]).toEqual(
      expect.objectContaining({
        type: 'CLOSE_SHORT',
        profit: round(
          exitProfit({ entryPrice: 100, exitPrice: 90, direction: 'SHORT' }),
        ),
      }),
    );
    expect(artifacts.orderLog[3].price).toBeCloseTo(
      90 * (1 + backtestSlippageRate),
    );
  });

  it('adds signal execution spread and market impact to replay slippage', async () => {
    const connector = createPortfolioReplayConnector(baseConnector);
    const dynamicSlippageRate =
      calculateEffectiveSlippageBps({
        baseSlippageBps: BACKTEST_BASE_SLIPPAGE_BPS,
        spreadBps: 15,
        marketImpactBps: 5,
      }) / 10_000;

    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        strategy: 'TrendLine',
        additionalIndicators: {
          executionSlippage: {
            spreadBps: 15,
            marketImpactBps: 5,
          },
        },
      } as any,
    });
    await connector.closePosition({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 110,
      timestamp: 2,
      direction: 'LONG',
    } as any);

    const artifacts = connector.getReplayArtifacts();
    expect(artifacts.orderLog[0].price).toBeCloseTo(
      100 * (1 + dynamicSlippageRate),
    );
    expect(artifacts.orderLog[1].price).toBeCloseTo(
      110 * (1 - dynamicSlippageRate),
    );
  });

  it('ignores signal delay risk in replay entry slippage', async () => {
    const connector = createPortfolioReplayConnector(baseConnector);
    const signal = {
      strategy: 'TrendLine',
      interval: '15',
      indicators: {
        candles15m: [{ close: 100 }, { close: 101 }, { close: 102 }],
      },
      additionalIndicators: {},
    };
    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal,
    } as any);
    await connector.closePosition({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 110,
      timestamp: 2,
      direction: 'LONG',
    } as any);

    const artifacts = connector.getReplayArtifacts();
    expect(artifacts.orderLog[0].price).toBeCloseTo(
      100 * (1 + backtestSlippageRate),
    );
    expect(artifacts.orderLog[1].price).toBeCloseTo(
      110 * (1 - backtestSlippageRate),
    );
    expect(artifacts.orderLog[0]).toEqual(
      expect.objectContaining({
        executionSlippageStage: 'entry',
        executionBaseSlippageBps: BACKTEST_BASE_SLIPPAGE_BPS,
        executionDelayRiskBps: 0,
      }),
    );
    expect(artifacts.orderLog[1]).toEqual(
      expect.objectContaining({
        executionSlippageStage: 'exit',
        executionBaseSlippageBps: BACKTEST_BASE_SLIPPAGE_BPS,
        executionDelayRiskBps: null,
      }),
    );
  });

  it('tracks multiple open positions and open pnl across symbols', async () => {
    const connector = createPortfolioReplayConnector(baseConnector);

    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        strategy: 'TrendLine',
      } as any,
    });
    await connector.placeOrder({
      symbol: 'ETHUSDT',
      qty: 2,
      price: 50,
      timestamp: 1,
      direction: 'SHORT',
      signal: {
        strategy: 'TrendShift',
      } as any,
    });

    await connector.advanceMarket({
      symbol: 'BTCUSDT',
      candle: {
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 0,
        turnover: 0,
        timestamp: 2,
      },
    });
    await connector.advanceMarket({
      symbol: 'ETHUSDT',
      candle: {
        open: 50,
        high: 52,
        low: 45,
        close: 46,
        volume: 0,
        turnover: 0,
        timestamp: 2,
      },
    });

    expect(await connector.getPositions()).toHaveLength(2);
    expect(connector.getOpenPositionPnl).toBeDefined();
    expect(await connector.getOpenPositionPnl!()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: 'BTCUSDT',
          unrealizedPnl: round(105 - executionPrice(100, 'LONG', 'entry')),
        }),
        expect.objectContaining({
          symbol: 'ETHUSDT',
          unrealizedPnl: round((executionPrice(50, 'SHORT', 'entry') - 46) * 2),
        }),
      ]),
    );
  });

  it('keeps separate strategy artifacts and closes positions by take profit', async () => {
    const connector = createPortfolioReplayConnector(baseConnector);

    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        strategy: 'TrendLine',
      } as any,
    });
    await connector.setTakeProfits({
      symbol: 'BTCUSDT',
      direction: 'LONG',
      takeProfits: [{ price: 110, rate: 1 }],
    });

    await connector.advanceMarket({
      symbol: 'BTCUSDT',
      candle: {
        open: 100,
        high: 111,
        low: 99,
        close: 108,
        volume: 0,
        turnover: 0,
        timestamp: 2,
      },
    });

    expect(await connector.getPosition('BTCUSDT')).toBeNull();

    const artifacts = connector.getReplayArtifacts();
    const expectedTpProfit = exitProfit({
      entryPrice: 100,
      exitPrice: 110,
      direction: 'LONG',
    });
    expect(artifacts.orderLog).toHaveLength(2);
    expect(artifacts.positionLog).toHaveLength(1);
    expect(artifacts.positionLog[0].netProfit).toBe(
      round(openProfit(100, 'LONG') + expectedTpProfit),
    );
    expect(artifacts.orderLogByStrategy.get('TrendLine')).toHaveLength(2);
    expect(artifacts.positionLogByStrategy.get('TrendLine')).toHaveLength(1);
    expect(artifacts.orderLog[0]).toEqual(
      expect.objectContaining({
        type: 'OPEN_LONG',
        price: executionPrice(100, 'LONG', 'entry'),
        fee: fee(executionPrice(100, 'LONG', 'entry')),
        profit: round(openProfit(100, 'LONG')),
      }),
    );
    expect(artifacts.orderLog[1]).toEqual(
      expect.objectContaining({
        type: 'TAKE_PROFIT_LONG',
        price: executionPrice(110, 'LONG', 'exit'),
        fee: fee(executionPrice(110, 'LONG', 'exit')),
        profit: round(expectedTpProfit),
        amount: round(
          INITIAL_BACKTEST_AMOUNT + openProfit(100, 'LONG') + expectedTpProfit,
        ),
      }),
    );
  });

  it('blocks closePosition from a different strategy owner', async () => {
    const connector = createPortfolioReplayConnector(baseConnector);

    await connector.placeOrder({
      symbol: 'BTCUSDT',
      qty: 1,
      price: 100,
      timestamp: 1,
      direction: 'LONG',
      signal: {
        strategy: 'AdaptiveTrendChannel',
      } as any,
    });

    await expect(
      connector.closePosition({
        symbol: 'BTCUSDT',
        price: 95,
        timestamp: 2,
        direction: 'LONG',
        signal: {
          strategy: 'TrendFollow',
        } as any,
      } as any),
    ).resolves.toBe(false);

    expect(await connector.getPosition('BTCUSDT')).toEqual(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        direction: 'LONG',
      }),
    );
    expect(connector.getReplayArtifacts().orderLog).toHaveLength(1);

    await expect(
      connector.closePosition({
        symbol: 'BTCUSDT',
        price: 105,
        timestamp: 3,
        direction: 'LONG',
        signal: {
          strategy: 'AdaptiveTrendChannel',
        } as any,
      } as any),
    ).resolves.toBe(true);

    expect(await connector.getPosition('BTCUSDT')).toBeNull();
    expect(connector.getReplayArtifacts().orderLog).toHaveLength(2);
  });
});
