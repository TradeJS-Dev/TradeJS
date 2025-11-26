import { Interval, Direction } from './trade';

export type TrendLineMode = 'lows' | 'highs';

export type TrendLine = {
  id: string;
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
}

export interface Signal {
  signalId: string;
  symbol: string;
  interval: Interval;
  direction: Direction;
  trendLines: {
    highs: TrendLine[];
    lows: TrendLine[];
  };
}

export interface Analysis {
  isBreakout: boolean;
  isTrendLine: boolean;
  isTrendLineFromExtremum: boolean;
  isWellTradedLevel: boolean;
  needRetest: boolean;

  direction: 'LONG' | 'SHORT' | null;
  currentTrend: 'UP' | 'DOWN' | null;
  btcTrend: 'UP' | 'DOWN' | null;
  isBitcoinCorrelation: boolean;

  currentPrice: number;
  entryPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  comment: string;

  timestamp: number;
}
