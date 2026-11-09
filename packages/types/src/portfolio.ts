import type { Direction } from './trade';

/** Explicitly opt in. R is frozen for the policy, not the sum of open risks. */
export interface PortfolioPolicyConfig {
  id: string;
  scope: 'strategy' | 'account' | { strategies: string[] };
  riskUnit: number;
  observationIntervalMs: number;
  maxPriceAgeMs: number;
  maxPositions?: number;
  profitExit?: {
    scope: 'position' | 'basket';
    multiple: number;
    minPositions?: number;
  };
  closeOppositeOnFill?: boolean;
}
export interface PortfolioPosition {
  id: string;
  strategy: string | null;
  symbol: string;
  direction: Direction;
  qty: number;
  entryPrice: number;
  markPrice: number | null;
  markedAt: number | null;
  stopLossPrice?: number | null;
}
export interface PortfolioOrderObservation {
  id: string;
  status: 'pending' | 'partial' | 'filled' | 'cancelled' | 'rejected';
  filledQty: number;
  positionId?: string;
}
export interface PortfolioObservation {
  asOf: number;
  positions: PortfolioPosition[];
  orders: PortfolioOrderObservation[];
}
export interface PortfolioReservation {
  id: string;
  signalId: string;
  strategy: string;
  symbol: string;
  direction: Direction;
  qty: number;
  timestamp: number;
  /** A reservation exists before any request can leave the process. */
  submitted: boolean;
  oppositeHandled: boolean;
}
export interface PortfolioCloseIntent {
  positionId: string;
  position: PortfolioPosition;
  reason:
    | 'PORTFOLIO_PROFIT_POSITION'
    | 'PORTFOLIO_PROFIT_BASKET'
    | 'PORTFOLIO_OPPOSITE_FILL';
  createdAt: number;
  lastAttemptAt: number | null;
}
export interface PortfolioState {
  schema: 'tradejs-portfolio/v1';
  revision: number;
  fingerprint: string;
  reservations: PortfolioReservation[];
  closing: PortfolioCloseIntent[];
  completedSignals: Record<string, number>;
  observedAt: number;
  evaluatedAt: number;
  blockedThrough: number;
}
export interface PortfolioContext {
  schema: 'tradejs-portfolio-context/v1';
  asOf: number;
  policyId: string;
  positionCount: number;
  pendingEntryCount: number;
  longCount: number;
  shortCount: number;
  grossUnrealizedPnlR: number | null;
  openStopRiskR: number | null;
  largestPositionShare: number | null;
  pricesComplete: boolean;
  unknownOwnershipCount: number;
}
export interface PortfolioStateStore {
  read(): Promise<PortfolioState | null>;
  compare(
    expected: PortfolioState | null,
    next: PortfolioState,
  ): Promise<boolean>;
}
