import { ByBitConnectorCreator } from './ByBit';
import { BinanceConnectorCreator } from './Binance';
import { CoinbaseConnectorCreator } from './Coinbase';
import { TestConnectorCreator } from './Test';

export enum ConnectorNames {
  ByBit = 'ByBit',
  Binance = 'Binance',
  Coinbase = 'Coinbase',
  Test = 'Test',
}

export enum ConnectorProviders {
  bybit = 'bybit',
  binance = 'binance',
  coinbase = 'coinbase',
}

export const providerToConnectorName: Record<
  ConnectorProviders,
  ConnectorNames
> = {
  [ConnectorProviders.bybit]: ConnectorNames.ByBit,
  [ConnectorProviders.binance]: ConnectorNames.Binance,
  [ConnectorProviders.coinbase]: ConnectorNames.Coinbase,
};

export const connectors = {
  [ConnectorNames.ByBit]: ByBitConnectorCreator,
  [ConnectorNames.Binance]: BinanceConnectorCreator,
  [ConnectorNames.Coinbase]: CoinbaseConnectorCreator,
  [ConnectorNames.Test]: TestConnectorCreator,
} as const;
