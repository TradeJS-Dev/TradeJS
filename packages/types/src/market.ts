export type MarketUniverse = 'crypto' | 'tradfi';

export type AssetClass = 'crypto' | 'equity' | 'commodity' | 'forex';

export type InstrumentKind = 'perpetual' | 'spot';

export type InstrumentStatus = 'trading' | 'inactive' | 'unknown';

export interface InstrumentDescriptor {
  provider: string;
  symbol: string;
  kind: InstrumentKind;
  assetClass: AssetClass;
  universe: MarketUniverse;
  status: InstrumentStatus;
  baseAsset?: string;
  quoteAsset?: string;
  settleAsset?: string;
  displayName?: string;
  venueMetadata?: Record<string, unknown>;
}

export interface ConnectorCapabilities {
  supportedUniverses: readonly MarketUniverse[];
  defaultUniverse: MarketUniverse;
}

export interface InstrumentQuery {
  universe?: MarketUniverse;
  assetClasses?: readonly AssetClass[];
  symbols?: readonly string[];
}

export interface TickerQuery extends InstrumentQuery {}

export interface FundingRatePoint {
  symbol: string;
  timestamp: number;
  rate: number;
}

export interface FundingRateHistoryRequest {
  symbol: string;
  startTime?: number;
  endTime: number;
  limit?: number;
}

export interface TradingFeeRate {
  symbol: string;
  makerRate: number;
  takerRate: number;
  source: 'exchange-account' | 'connector-default' | 'fallback';
  capturedAt: number;
}

export interface TradingAccountRef {
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  isDefault?: boolean;
  universes: MarketUniverse[];
  environment: 'mainnet' | 'testnet';
  apiKey?: string;
  apiSecret?: string;
  uid?: string;
  readOnly?: boolean;
  lastCheckedAt?: number;
  lastError?: string;
}

export interface RuntimeDeploymentStrategy {
  strategyName: string;
  /** Immutable per-strategy release selected for this deployment. */
  releaseVersion?: number;
  /** New entries may be paused while exit/position management keeps running. */
  controlState?: import('./runtimeStrategyReleases').RuntimeStrategyControlState;
  /** @deprecated Legacy runtime identity. Use releaseVersion. */
  policyProfileId?: string;
  /** @deprecated Legacy evidence identity. Use releaseVersion. */
  releaseCompositionId?: string;
  /** @deprecated Legacy all-or-nothing switch. Use controlState. */
  enabled?: boolean;
  /** @deprecated Runtime config belongs to an immutable strategy release. */
  config?: Record<string, unknown>;
}

export interface RuntimeDeployment {
  id: string;
  label: string;
  connectorName: string;
  provider: string;
  accountId: string;
  universe: MarketUniverse;
  interval: string;
  enabled: boolean;
  strategies: RuntimeDeploymentStrategy[];
  assetClasses?: AssetClass[];
  tickers?: string[];
}

export interface RuntimeDeploymentHeartbeat {
  deploymentId: string;
  status: 'running' | 'stopped' | 'error';
  pid: number;
  startedAt: number;
  lastCycleAt: number;
  lastError?: string;
}

export type MarketDataCapability =
  | 'target.mtf'
  | 'target.funding'
  | 'target.openInterest'
  | 'crypto.btcReference'
  | 'crypto.ethReference'
  | 'crypto.derivatives'
  | 'crypto.marketBreadth'
  | 'crypto.crossVenueSpread'
  | 'crypto.coinMarketCap';

export const DEFAULT_MARKET_UNIVERSE: MarketUniverse = 'crypto';

export const isMarketUniverse = (value: unknown): value is MarketUniverse =>
  value === 'crypto' || value === 'tradfi';

export const resolveConnectorUniverse = (
  capabilities: ConnectorCapabilities,
  requested?: unknown,
): MarketUniverse => {
  if (requested == null || requested === '') {
    return capabilities.defaultUniverse;
  }

  if (!isMarketUniverse(requested)) {
    throw new Error(`Unknown market universe: ${String(requested)}`);
  }

  if (!capabilities.supportedUniverses.includes(requested)) {
    throw new Error(`Unsupported market universe: ${requested}`);
  }

  return requested;
};
