import type { Direction } from '@tradejs/types';

export interface VolatilityCompressionBreakoutSignalContext {
  signalDirection: Direction;
  breakoutState: string | null;
  atrPctRank100: number | null;
  bbWidthRank100: number | null;
  rangeExpansionRank20: number | null;
  breakoutBodyAtr: number | null;
  breakoutLevel: number | null;
  breakoutDistanceAtr: number | null;
  acceptanceCloses: number | null;
  volumeRel20: number | null;
  buyPressurePct: number | null;
  tradeFlowBuyPressurePct: number | null;
  mtfAlignment: string | null;
  compressionConfirmed: boolean;
  expansionConfirmed: boolean;
  directionalBodyConfirmed: boolean;
  participationConfirmed: boolean;
  mtfConfirmed: boolean | null;
  tradeFlowConfirmed: boolean | null;
}
