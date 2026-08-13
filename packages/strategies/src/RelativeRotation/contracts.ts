import type { Direction } from '@tradejs/types';

export interface RelativeRotationSignalContext {
  signalDirection: Direction;
  targetVsBtcRatioTrend: string | null;
  targetVsBtcAlpha24h: number | null;
  targetVsBtcRatioReturn24h: number | null;
  targetVsBtcBeta20: number | null;
  targetVsBtcCorrelation20: number | null;
  targetVsEthRatioTrend: string | null;
  targetVsEthAlpha24h: number | null;
  targetVsEthRatioReturn24h: number | null;
  relativeStrength1h: number | null;
  btcAltRegime: string | null;
  marketBreadthReturn: number | null;
  volumeRel20: number | null;
  rotationScore: number;
  ratioTrendConfirmed: boolean;
  alphaConfirmed: boolean;
  ratioReturnConfirmed: boolean;
  relativeStrengthConfirmed: boolean;
  regimeConfirmed: boolean | null;
}
