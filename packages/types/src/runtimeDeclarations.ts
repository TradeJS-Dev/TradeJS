import type { StrategyConfig } from './backtest';
import type { AssetClass } from './market';

/** One immutable strategy package + effective project config revision. */
export interface RuntimeStrategyDeclaration {
  version: number;
  enabled: boolean;
  config: StrategyConfig;
}

/** Git-owned execution target. Credentials remain server-owned. */
export interface RuntimeDeploymentDeclaration {
  label?: string;
  connectorName: string;
  provider?: string;
  accountId: string;
  enabled?: boolean;
  strategies: Record<string, RuntimeStrategyDeclaration>;
  assetClasses?: AssetClass[];
  tickers?: string[];
}

export interface TradejsRuntimeDeclaration {
  deployments: Record<string, RuntimeDeploymentDeclaration>;
}
