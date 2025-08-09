import { StrategyConfig } from './backtest';

export interface Bot {
  symbol: string;
  disabled?: boolean;
  strategyName: string;
  strategyConfig: StrategyConfig;
  connectorName: string;
}

export interface BotStatus {
  symbol: string;
  status: string;
}

export type BotResults = BotStatus[];

export type BotConfig = Bot[];
