import type { Candle, Indicator } from './trade';
import type { IndicatorSnapshot } from './strategyContext';

export interface IndicatorPluginComputeParams {
  candle: Candle;
  btcCandle?: Candle;
  data: Candle[];
  btcData: Candle[];
  baseResult: Partial<IndicatorSnapshot>;
}

export interface IndicatorPluginFigureRenderer {
  key: string;
  title?: string;
  type?: 'line' | 'bar';
  color?: string;
  lineWidth?: number;
  dashed?: boolean;
  constant?: number;
}

export interface IndicatorPluginRenderer {
  indicatorName?: string;
  shortName?: string;
  paneId?: string;
  minHeight?: number;
  figures: IndicatorPluginFigureRenderer[];
}

export interface IndicatorPluginEntry {
  indicator: Indicator;
  historyKey?: string;
  compute?: (params: IndicatorPluginComputeParams) => number | null | undefined;
  renderer?: IndicatorPluginRenderer;
}

export interface IndicatorPluginDefinition {
  indicatorEntries: IndicatorPluginEntry[];
}
