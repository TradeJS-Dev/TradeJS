import { Interval, Direction, Trend } from './trade';

export type TrendLineMode = 'lows' | 'highs';

export type TrendLine = {
  id: string;
  mode: TrendLineMode;
  touches: { timestamp: number; value: number }[];
  points: { timestamp: number; value: number }[];
};

export interface TrendLineOptions {
  mode: TrendLineMode;
  maxLines?: number; // ограничение перебора пар опор (кандидатов)
  range?: number; // окно для локальных экстремумов (в барах)
  epsilon?: number; // допуск как доля цены (0.01 = 1%) — применяется для касаний, фитилей между опорами и close-пробоев ДО offset
  epsilonOffset?: number; // размер окна в конце (в барах)
  minTouches?: number; // минимум касаний по телу (с учётом minTouchGap)
  minDistance?: number; // минимум баров между опорами/крайними касаниями
  firstRange?: number; // «сила» первой опоры (окно сильного экстремума)
  offset?: number; // размер окна в конце (в барах)
  minTouchGap?: number; // минимум баров между касаниями
  capture?: boolean; // true: в окне offset обязателен «старт за линией» и цвет свечи (строго, без допуска)
  bestLines?: number;
  maxDistance?: number;
}

export interface Signal {
  signalId: string;
  symbol: string;
  interval: Interval;
  strategy: string;
  direction: Direction;
  trendLine: TrendLine;
  currentPrice: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRatio: number;
  timestamp: number;
  correlation: number;
  touches: number;
  support: number;
  trend: Trend;
}
