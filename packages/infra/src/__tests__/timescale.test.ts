describe('timescale candle helpers', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.restoreAllMocks();
    delete process.env.PG_POOL_MAX;
    delete process.env.PG_CONNECTION_TIMEOUT_MS;
    delete (global as typeof globalThis & { __pgPool__?: unknown }).__pgPool__;
  });

  it('normalizes provider and symbol in toRows', async () => {
    const { toRows } = await import('@tradejs/infra/timescale');

    const rows = toRows(' Binance ', 'btcusdt', 15, [
      {
        timestamp: 1_000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
        dt: '1970-01-01T00:00:01.000Z',
      },
    ]);

    expect(rows).toEqual([
      {
        provider: 'binance',
        symbol: 'BTCUSDT',
        interval: 15,
        ts: new Date(1_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
        takerBuyBaseVolume: null,
        takerBuyQuoteVolume: null,
        takerSellBaseVolume: null,
        takerSellQuoteVolume: null,
      },
    ]);
  });

  it('preserves Binance taker volume fields in toRows', async () => {
    const { toRows } = await import('@tradejs/infra/timescale');

    const rows = toRows('binance', 'ETHUSDT', 15, [
      {
        timestamp: 1_000,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
        takerBuyBaseVolume: 7,
        takerBuyQuoteVolume: 14,
        takerSellBaseVolume: 3,
        takerSellQuoteVolume: 6,
        dt: '1970-01-01T00:00:01.000Z',
      },
    ]);

    expect(rows[0]).toMatchObject({
      takerBuyBaseVolume: 7,
      takerBuyQuoteVolume: 14,
      takerSellBaseVolume: 3,
      takerSellQuoteVolume: 6,
    });
  });

  it('throws when provider is empty in toRows', async () => {
    const { toRows } = await import('@tradejs/infra/timescale');

    expect(() => toRows('  ', 'BTCUSDT', 15, [])).toThrow(
      'Candle provider is required',
    );
  });

  it('uses provider in upsert conflict key and query params', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined),
      release: jest.fn(),
    };
    const connect = jest.fn().mockResolvedValue(client);

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect,
        query: jest.fn().mockResolvedValue({ rows: [] }),
      })),
    }));

    const { upsertCandles } = await import('@tradejs/infra/timescale');

    await upsertCandles([
      {
        provider: 'Coinbase',
        symbol: 'btcusdt',
        interval: 15,
        ts: new Date(1_000),
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        turnover: 20,
        takerBuyBaseVolume: 7,
        takerBuyQuoteVolume: 14,
        takerSellBaseVolume: 3,
        takerSellQuoteVolume: 6,
      },
    ]);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('ON CONFLICT (provider, symbol, interval, ts)'),
      [
        'coinbase',
        'BTCUSDT',
        15,
        new Date(1_000),
        1,
        2,
        0.5,
        1.5,
        10,
        20,
        7,
        14,
        3,
        6,
      ],
    );
    expect(client.query).toHaveBeenNthCalledWith(3, 'COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('closes singleton pool so one-shot CLI commands can exit', async () => {
    const end = jest.fn().mockResolvedValue(undefined);
    const query = jest.fn().mockResolvedValue({ rows: [] });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
        end,
      })),
    }));

    const { closeTimescalePool, getCandlesRange } = await import(
      '@tradejs/infra/timescale'
    );

    await getCandlesRange('ByBit', 'btcusdt', 15, 1_000, 2_000);
    await closeTimescalePool();
    await closeTimescalePool();

    expect(end).toHaveBeenCalledTimes(1);
    expect(
      (global as typeof globalThis & { __pgPool__?: unknown }).__pgPool__,
    ).toBeUndefined();
  });

  it('uses configurable pool size and a longer connection timeout', async () => {
    process.env.PG_POOL_MAX = '17';
    process.env.PG_CONNECTION_TIMEOUT_MS = '45000';

    const query = jest.fn().mockResolvedValue({ rows: [] });
    const Pool = jest.fn().mockImplementation(() => ({
      connect: jest.fn(),
      query,
      end: jest.fn(),
    }));

    jest.doMock('pg', () => ({ Pool }));

    const { getCandlesRange } = await import('@tradejs/infra/timescale');

    await getCandlesRange('ByBit', 'btcusdt', 15, 1_000, 2_000);

    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 17,
        connectionTimeoutMillis: 45_000,
      }),
    );
  });

  it('scopes candle reads and deletes by provider', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('pg_advisory_lock')) return { rows: [] };
      if (sql.includes('ALTER TABLE candles')) return { rows: [] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [] };
      if (sql.includes('diff_seconds')) {
        return {
          rows: [
            {
              ts: new Date(2_000),
              prev_ts: new Date(1_000),
              diff_seconds: 120,
            },
          ],
        };
      }
      if (sql.includes('SELECT symbol, interval, ts')) {
        return { rows: [{ ts: new Date(1_000) }] };
      }
      if (sql.includes('ORDER BY ts ASC')) return { rows: [{ ms: '1000' }] };
      if (sql.includes('ORDER BY ts DESC')) return { rows: [{ ms: '2000' }] };
      if (sql.includes('DELETE FROM candles')) return { rows: [] };
      return { rows: [] };
    });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const { getCandlesRange, getDataEdges, deleteCandles, findContinuityGap } =
      await import('@tradejs/infra/timescale');

    await getCandlesRange('ByBit', 'btcusdt', 15, 1_000, 2_000);
    await expect(getDataEdges('ByBit', 'btcusdt', 15)).resolves.toEqual({
      min: 1_000,
      max: 2_000,
    });
    await deleteCandles('ByBit', 'btcusdt', 15);
    await expect(findContinuityGap('ByBit', 'btcusdt', 2)).resolves.toEqual({
      ts: 2_000,
      prevTs: 1_000,
      diffSeconds: 120,
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'WHERE provider = $1 AND symbol = $2 AND interval = $3',
      ),
      ['bybit', 'BTCUSDT', 15, 1_000, 2_000],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'WHERE provider=$1 AND symbol=$2 AND interval=$3',
      ),
      ['bybit', 'BTCUSDT', 15],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'WHERE provider=$1 AND symbol=$2 AND interval=$3',
      ),
      ['bybit', 'BTCUSDT', 15],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM candles'),
      ['bybit', 'BTCUSDT', 15],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'WHERE provider = $1 AND symbol = $2 AND interval = $3',
      ),
      ['bybit', 'BTCUSDT', 2, 120],
    );
  });

  it('stores and reads derivatives backfill coverage markers', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM derivatives_backfill_coverage')) {
        return {
          rows: [
            {
              symbol: 'BTCUSDT',
              interval: '1h',
              from_ms: '1000',
              to_ms: '2000',
              rows_count: '0',
            },
          ],
        };
      }
      return { rows: [] };
    });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const {
      getDerivativesBackfillCoverage,
      upsertDerivativesBackfillCoverage,
    } = await import('@tradejs/infra/timescale');

    await upsertDerivativesBackfillCoverage([
      {
        source: 'Coinalyze',
        symbol: 'btcusdt',
        interval: '1h',
        fromMs: 1_000,
        toMs: 2_000,
        rowsCount: 0,
      },
    ]);

    await expect(
      getDerivativesBackfillCoverage({
        source: 'coinalyze',
        symbols: ['btcusdt'],
        interval: '1h',
        fromMs: 1_000,
        toMs: 2_000,
      }),
    ).resolves.toEqual([
      {
        symbol: 'BTCUSDT',
        interval: '1h',
        fromMs: 1_000,
        toMs: 2_000,
        rowsCount: 0,
      },
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO derivatives_backfill_coverage'),
      ['coinalyze', 'BTCUSDT', '1h', new Date(1_000), new Date(2_000), 0],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM derivatives_backfill_coverage'),
      ['coinalyze', ['BTCUSDT'], '1h', 1_000, 2_000],
    );
  });

  it('upserts Binance market feature rows into compact tables', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const {
      upsertMarketBreadthRows,
      upsertMarketOrderBookDepthRows,
      upsertMarketTradeFlowRows,
    } = await import('@tradejs/infra/timescale');

    await upsertMarketTradeFlowRows([
      {
        symbol: 'BTCUSDT',
        interval: '1m',
        ts: new Date(1_000),
        trades: 2,
        buyBaseVolume: 3,
        sellBaseVolume: 1,
        buyQuoteVolume: 300,
        sellQuoteVolume: 100,
        netBaseDelta: 2,
        netQuoteDelta: 200,
        buyPressurePct: 0.75,
        source: 'binance_agg_trades',
      },
    ]);
    await upsertMarketOrderBookDepthRows([
      {
        venue: 'binance',
        symbol: 'BTCUSDT',
        ts: new Date(2_000),
        lastUpdateId: 7,
        bid: 99,
        ask: 101,
        mid: 100,
        spreadBps: 200,
        levels: [
          {
            levels: 5,
            bidBaseVolume: 1,
            askBaseVolume: 2,
            bidQuoteVolume: 99,
            askQuoteVolume: 202,
            imbalance: -0.34,
          },
        ],
        rawBidLevels: 5,
        rawAskLevels: 5,
        source: 'binance_depth',
      },
    ]);
    await upsertMarketBreadthRows([
      {
        universe: 'top30_usdt',
        interval: '15m',
        ts: new Date(3_000),
        symbolsCount: 30,
        advancers: 20,
        decliners: 8,
        unchanged: 2,
        advanceDeclineRatio: 2.5,
        pctAboveMa20: 0.6,
        pctAboveMa50: 0.5,
        equalWeightedReturn: 0.01,
        volumeWeightedReturn: 0.02,
        dispersion: 0.03,
        source: 'binance_klines',
      },
    ]);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO market_trade_flow'),
      expect.arrayContaining(['BTCUSDT', '1m', new Date(1_000), 2]),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO market_order_book_depth'),
      expect.arrayContaining([
        'binance',
        'BTCUSDT',
        new Date(2_000),
        7,
        99,
        101,
        100,
        200,
        expect.any(String),
      ]),
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO market_breadth'),
      expect.arrayContaining(['top30_usdt', '15m', new Date(3_000), 30]),
    );
  });

  it('chunks large Binance market breadth upserts below the pg bind limit', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const { upsertMarketBreadthRows } = await import(
      '@tradejs/infra/timescale'
    );
    const rows = Array.from({ length: 2_200 }, (_, index) => ({
      universe: 'top30_usdt',
      interval: '15m' as const,
      ts: new Date(3_000 + index * 60_000),
      symbolsCount: 30,
      advancers: 20,
      decliners: 8,
      unchanged: 2,
      advanceDeclineRatio: 2.5,
      pctAboveMa20: 0.6,
      pctAboveMa50: 0.5,
      equalWeightedReturn: 0.01,
      volumeWeightedReturn: 0.02,
      dispersion: 0.03,
      source: 'binance_klines' as const,
    }));

    await upsertMarketBreadthRows(rows);

    const insertCalls = query.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO market_breadth'),
    );
    expect(insertCalls).toHaveLength(3);
    for (const [, params] of insertCalls) {
      expect((params as unknown[]).length).toBeLessThanOrEqual(30_000);
    }
  });

  it('reads latest Binance market feature rows as-of a timestamp', async () => {
    const atMs = 10_000;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM market_trade_flow')) {
        return {
          rows: [
            {
              symbol: 'BTCUSDT',
              interval: '15m',
              ts: new Date(9_000),
              trades: 3,
              buyBaseVolume: '2',
              sellBaseVolume: '1',
              buyPressurePct: '0.6667',
              source: 'binance_agg_trades',
            },
          ],
        };
      }
      if (sql.includes('FROM market_order_book_depth')) {
        return {
          rows: [
            {
              venue: 'binance',
              symbol: 'BTCUSDT',
              ts: new Date(8_000),
              bid: '99',
              ask: '101',
              mid: '100',
              spreadBps: '200',
              levels: [{ levels: 5, imbalance: 0.25 }],
              source: 'binance_depth',
            },
          ],
        };
      }
      if (sql.includes('FROM market_breadth')) {
        return {
          rows: [
            {
              universe: 'binance_top30_usdt',
              interval: '15m',
              ts: new Date(7_000),
              symbolsCount: 30,
              advancers: 20,
              decliners: 8,
              unchanged: 2,
              equalWeightedReturn: '0.01',
              source: 'binance_klines',
            },
          ],
        };
      }
      return { rows: [] };
    });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const {
      getLatestMarketBreadth,
      getLatestMarketOrderBookDepth,
      getLatestMarketTradeFlow,
    } = await import('@tradejs/infra/timescale');

    await expect(
      getLatestMarketTradeFlow({
        symbol: 'btcusdt',
        interval: '15m',
        atMs,
        maxAgeMs: 2_000,
      }),
    ).resolves.toMatchObject({
      symbol: 'BTCUSDT',
      ageMs: 1_000,
      stale: false,
      buyPressurePct: '0.6667',
    });
    await expect(
      getLatestMarketOrderBookDepth({
        venue: 'binance',
        symbol: 'BTCUSDT',
        atMs,
        maxAgeMs: 1_000,
      }),
    ).resolves.toMatchObject({
      symbol: 'BTCUSDT',
      ageMs: 2_000,
      stale: true,
      levels: [{ levels: 5, imbalance: 0.25 }],
    });
    await expect(
      getLatestMarketBreadth({
        universe: 'binance_top30_usdt',
        interval: '15m',
        atMs,
        maxAgeMs: 5_000,
      }),
    ).resolves.toMatchObject({
      universe: 'binance_top30_usdt',
      ageMs: 3_000,
      stale: false,
      equalWeightedReturn: '0.01',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ts <= to_timestamp($3/1000.0)'),
      ['BTCUSDT', '15m', atMs],
    );
  });

  it('upserts normalized onchain flow rows', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const { upsertOnchainFlowRows } = await import('@tradejs/infra/timescale');

    await upsertOnchainFlowRows([
      {
        symbol: 'ethusdt',
        interval: '15m',
        ts: new Date(1_000),
        whaleNetFlowUsd: 1000,
        smartTraderNetFlowUsd: 500,
        cexDepositUsd: 100,
        cexWithdrawUsd: 900,
        dexBuyUsd: 300,
        dexSellUsd: 50,
        entityCount: 4,
        confidenceWeightedBias: 0.6,
        source: 'arkham',
      },
    ]);

    const insertCall = query.mock.calls.find((call) =>
      String(call[0]).includes('INSERT INTO onchain_flow_context'),
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall?.[0]).toContain(
      'ON CONFLICT (symbol, interval, ts) DO UPDATE SET',
    );
    expect(insertCall?.[1]).toEqual([
      'ETHUSDT',
      '15m',
      new Date(1_000),
      1000,
      500,
      100,
      900,
      300,
      50,
      4,
      0.6,
      'arkham',
    ]);
  });

  it('reads onchain context windows and maps SQL columns', async () => {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM onchain_flow_context')) {
        return {
          rows: [
            {
              symbol: 'ETHUSDT',
              interval: '15m',
              ts: new Date(2_000),
              whale_net_flow_usd: 1000,
              smart_trader_net_flow_usd: 500,
              cex_deposit_usd: 100,
              cex_withdraw_usd: 900,
              dex_buy_usd: 300,
              dex_sell_usd: 50,
              entity_count: 4,
              confidence_weighted_bias: 0.6,
              source: 'arkham',
            },
          ],
        };
      }
      return { rows: [] };
    });

    jest.doMock('pg', () => ({
      Pool: jest.fn().mockImplementation(() => ({
        connect: jest.fn(),
        query,
      })),
    }));

    const { getOnchainContextWindow } = await import(
      '@tradejs/infra/timescale'
    );

    await expect(
      getOnchainContextWindow({
        symbol: 'ethusdt',
        intervals: ['15m', '1h'],
        endMs: 10_000,
        lookbackMs: 5_000,
      }),
    ).resolves.toEqual({
      '15m': [
        {
          symbol: 'ETHUSDT',
          interval: '15m',
          ts: new Date(2_000),
          whaleNetFlowUsd: 1000,
          smartTraderNetFlowUsd: 500,
          cexDepositUsd: 100,
          cexWithdrawUsd: 900,
          dexBuyUsd: 300,
          dexSellUsd: 50,
          entityCount: 4,
          confidenceWeightedBias: 0.6,
          source: 'arkham',
        },
      ],
    });

    const selectCall = query.mock.calls.find((call) =>
      String(call[0]).includes('FROM onchain_flow_context'),
    );
    expect(selectCall?.[1]).toEqual(['ETHUSDT', ['15m', '1h'], 5_000, 10_000]);
  });
});
