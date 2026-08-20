import type { StrategyConfig } from './backtest';
import type { AssetClass } from './market';

export interface RuntimeStrategySelection {
  tickers: string[];
}

/** One immutable strategy package + effective project config revision. */
export interface RuntimeStrategyDeclaration {
  version: number;
  enabled: boolean;
  selection?: RuntimeStrategySelection;
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
  /** Default selection for strategy bindings that do not declare one. */
  tickers?: string[];
}

export interface TradejsRuntimeDeclaration {
  deployments: Record<string, RuntimeDeploymentDeclaration>;
}
