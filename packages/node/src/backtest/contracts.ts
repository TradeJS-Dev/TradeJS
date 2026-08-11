import type { Interval, KlineChartData, KlineChartItem } from '@tradejs/types';

export type PreparedBacktestData = {
  data: KlineChartData;
  btcData: KlineChartData;
  ethData: KlineChartData;
  prevData: KlineChartData;
  btcPrevData: KlineChartData;
  ethPrevData: KlineChartData;
  testData: KlineChartData;
  btcTestData: KlineChartData;
  ethTestData: KlineChartData;
  btcBinanceData: KlineChartData;
  btcCoinbaseData: KlineChartData;
  backtestExecutionInterval: Interval;
  backtestExecutionData: KlineChartData;
  backtestExecutionBtcData: KlineChartData;
  backtestExecutionDataByTimestamp: Map<number, KlineChartItem>;
  backtestExecutionBtcDataByTimestamp: Map<number, KlineChartItem>;
};

export type BacktestSessionMonitor = {
  run<T>(stage: string, action: () => Promise<T>): Promise<T>;
  runStrategy<T>(stage: string, action: () => Promise<T>): Promise<T>;
  contextStage(stage: string): void;
};
