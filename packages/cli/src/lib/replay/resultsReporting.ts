import chalk from 'chalk';
import {
  extractBacktestEntryParityEntries,
  type TradeParityEntry,
} from '../runtimeParity';
import { createTable } from '../runFormatting';
import type { HistoricalSignalsReplayResult } from './historicalSignalsReplay';
import {
  REPLAY_RESULTS_BY_STRATEGY_HEADERS,
  type ReplayStrategyResultsSnapshot,
  type ReplayStrategySummary,
} from './support';

export const saveAndPrintReplayResultsByStrategy = async ({
  replayResult,
  tickers,
}: {
  replayResult: HistoricalSignalsReplayResult;
  tickers: string[];
}): Promise<ReplayStrategyResultsSnapshot> => {
  const backtestEntries: TradeParityEntry[] = replayResult.strategies.flatMap(
    ({ orderLog }) => extractBacktestEntryParityEntries(orderLog),
  );
  const summaries = replayResult.strategies
    .map(({ strategyName, strategyConfig, positionLog }) => {
      const realizedPnl = positionLog.map((position) =>
        Number.isFinite(position.netProfit)
          ? Number(position.netProfit)
          : position.close.amount - position.open.amount,
      );
      const orders = realizedPnl.length;
      const wins = realizedPnl.filter((pnl) => pnl > 0).length;
      const losses = realizedPnl.filter((pnl) => pnl <= 0).length;
      const netProfit = Number(
        realizedPnl.reduce((sum, pnl) => sum + pnl, 0).toFixed(2),
      );
      const winRate =
        orders > 0 ? Number(((wins / orders) * 100).toFixed(2)) : 0;
      const avgTradeProfit =
        orders > 0 ? Number((netProfit / orders).toFixed(2)) : 0;
      const tradedSymbols = new Set(
        backtestEntries
          .filter((entry) => entry.strategy === strategyName)
          .map((entry) => entry.symbol),
      );

      return {
        strategyName,
        strategyConfig,
        tickers: tickers.length,
        tickersWithTrades: tradedSymbols.size,
        orders,
        wins,
        losses,
        netProfit,
        avgTradeProfit,
        winRate,
      } satisfies ReplayStrategySummary;
    })
    .sort(
      (left, right) =>
        right.netProfit - left.netProfit ||
        left.strategyName.localeCompare(right.strategyName),
    );

  const rows = summaries.map((summary) => {
    const profit = `${summary.netProfit.toFixed(2)}$`;
    const avgTrade = `${summary.avgTradeProfit.toFixed(2)}$`;
    const profitColor =
      summary.netProfit > 0
        ? chalk.green
        : summary.netProfit < 0
          ? chalk.red
          : chalk.gray;
    const avgTradeColor =
      summary.avgTradeProfit > 0
        ? chalk.green
        : summary.avgTradeProfit < 0
          ? chalk.red
          : chalk.gray;

    return [
      chalk.blue(summary.strategyName),
      chalk.yellow(String(summary.tickers)),
      chalk.yellow(String(summary.tickersWithTrades)),
      chalk.cyan(String(summary.orders)),
      chalk.cyan(
        `${summary.wins}/${summary.losses} (${summary.winRate.toFixed(2)}%)`,
      ),
      profitColor(profit),
      avgTradeColor(avgTrade),
    ];
  });

  console.log('');
  console.log('SIGNALS REPLAY RESULTS BY STRATEGY:');
  console.log(createTable(REPLAY_RESULTS_BY_STRATEGY_HEADERS, rows));
  console.log('');

  return {
    summaries,
    backtestEntries,
  };
};
