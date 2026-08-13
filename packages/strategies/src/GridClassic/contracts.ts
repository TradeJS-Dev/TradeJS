export type GridClassicEconomicsRejectReason =
  | 'target_distance'
  | 'net_risk_ratio';

export interface GridClassicEntryEconomics {
  accepted: boolean;
  rejectReason: GridClassicEconomicsRejectReason | null;
  targetDistanceBps: number;
  grossReward: number;
  executionCosts: number;
  netReward: number;
  netRisk: number;
  netRiskRatio: number;
}
