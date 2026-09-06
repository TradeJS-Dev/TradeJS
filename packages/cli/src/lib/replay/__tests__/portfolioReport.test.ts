import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PositionLogData } from '@tradejs/types';
import {
  calculatePortfolioMetricRow,
  tradesFromPositionLog,
  writePortfolioReport,
} from '../portfolioReport';

describe('portfolio backtest report', () => {
  it('uses canonical per-position net profit instead of overlapping account deltas', () => {
    const positions = [
      {
        direction: 'LONG',
        open: { timestamp: 1, amount: 100 },
        close: { timestamp: 2, amount: 140 },
        netProfit: 5,
      },
    ] as PositionLogData;

    expect(tradesFromPositionLog('Alpha', positions)).toEqual([
      {
        strategyName: 'Alpha',
        direction: 'LONG',
        openedAt: 1,
        exitedAt: 2,
        pnl: 5,
      },
    ]);
  });

  it('calculates aggregate realized metrics in chronological exit order', () => {
    const row = calculatePortfolioMetricRow({
      trades: [
        {
          strategyName: 'Alpha',
          direction: 'LONG',
          openedAt: 1,
          exitedAt: 2,
          pnl: 10,
        },
        {
          strategyName: 'Beta',
          direction: 'SHORT',
          openedAt: 2,
          exitedAt: 3,
          pnl: -4,
        },
        {
          strategyName: 'Alpha',
          direction: 'LONG',
          openedAt: 3,
          exitedAt: 4,
          pnl: 2,
        },
      ],
      window: 'full',
      scope: 'PORTFOLIO',
      cohort: 'ALL',
      start: 0,
      end: 86_400_000,
    });

    expect(row).toMatchObject({
      n: 3,
      wins: 2,
      losses: 1,
      pnl: 8,
      pnlPerTrade: 2.66666667,
      profitFactor: 3,
      winRate: 66.66666667,
      realizedMaxDrawdown: 4,
      cadencePerDay: 3,
    });
  });

  it('keeps empty direction cohorts explicit', () => {
    const row = calculatePortfolioMetricRow({
      trades: [],
      window: '7d',
      scope: 'PORTFOLIO',
      cohort: 'SHORT',
      start: 0,
      end: 7 * 86_400_000,
    });

    expect(row).toMatchObject({
      n: 0,
      pnl: 0,
      pnlPerTrade: null,
      profitFactor: null,
      winRate: null,
      realizedMaxDrawdown: 0,
      cadencePerDay: 0,
    });
  });

  it('keeps per-strategy rows separate from the portfolio total', async () => {
    const projectRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'portfolio-report-'),
    );
    try {
      const position = (pnl: number) =>
        [
          {
            direction: 'LONG',
            open: { timestamp: 1, amount: 100 },
            close: { timestamp: 2, amount: 100 + pnl },
            netProfit: pnl,
          },
        ] as PositionLogData;
      const output = await writePortfolioReport({
        projectRoot,
        timestamp: 'test',
        replayResult: {
          strategies: [
            {
              strategyName: 'Alpha',
              strategyConfig: {} as never,
              orderLog: [],
              positionLog: position(10),
              stat: null,
            },
            {
              strategyName: 'Beta',
              strategyConfig: {} as never,
              orderLog: [],
              positionLog: position(-4),
              stat: null,
            },
          ],
          signals: [],
          orderLog: [],
          positionLog: [],
          cycleCount: 1,
          abortedCycles: 0,
          runtimeLineages: [],
          replayLineageScopes: [],
        },
        window: { start: 0, end: 86_400_000 },
        lineage: { maxLossValue: 10 },
        command: 'tradejs portfolio-backtest',
      });
      const report = JSON.parse(await fs.readFile(output.json, 'utf8')) as {
        metrics: {
          portfolio: Array<{ window: string; cohort: string; pnl: number }>;
          strategies: Array<{ window: string; scope: string; pnl: number }>;
        };
        curves: {
          portfolioEquity: Array<{ timestamp: number; value: number }>;
        };
      };

      expect(
        report.metrics.portfolio.find(
          (row) => row.window === 'full' && row.cohort === 'ALL',
        )?.pnl,
      ).toBe(6);
      expect(
        report.metrics.strategies.find(
          (row) => row.window === 'full' && row.scope === 'Alpha',
        )?.pnl,
      ).toBe(10);
      expect(
        report.metrics.strategies.find(
          (row) => row.window === 'full' && row.scope === 'Beta',
        )?.pnl,
      ).toBe(-4);
      expect(report.curves.portfolioEquity[0]).toEqual({
        timestamp: 0,
        value: 0,
      });
      expect(report.curves.portfolioEquity.at(-1)).toEqual({
        timestamp: 86_400_000,
        value: 6,
      });
      const equitySvg = await fs.readFile(output.equitySvg, 'utf8');
      expect(equitySvg).toContain('PORTFOLIO');
      expect(equitySvg).toContain('Alpha');
      expect(equitySvg).toContain('Beta');
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });
});
