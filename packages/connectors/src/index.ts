import { ByBitConnectorCreator } from './ByBit';
import { BinanceConnectorCreator } from './Binance';
import { CoinbaseConnectorCreator } from './Coinbase';
import { TestConnectorCreator } from './Test';

import { ConnectorCreator, ConnectorRegistryEntry } from '@tradejs/types';

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

export const getConnectorProviders = (): ConnectorProviders[] =>
  Object.keys(providerToConnectorName) as ConnectorProviders[];

export const resolveConnectorNameByProvider = (
  provider: unknown,
): ConnectorNames | null => {
  const normalized = String(provider || '')
    .trim()
    .toLowerCase() as ConnectorProviders;
  return providerToConnectorName[normalized] || null;
};

export const connectors = {
  [ConnectorNames.ByBit]: ByBitConnectorCreator,
  [ConnectorNames.Binance]: BinanceConnectorCreator,
  [ConnectorNames.Coinbase]: CoinbaseConnectorCreator,
  [ConnectorNames.Test]: TestConnectorCreator,
} as const;

export const connectorEntries: ConnectorRegistryEntry[] = [
  {
    name: ConnectorNames.ByBit,
    creator: ByBitConnectorCreator,
    providers: [ConnectorProviders.bybit],
  },
  {
    name: ConnectorNames.Binance,
    creator: BinanceConnectorCreator,
    providers: [ConnectorProviders.binance],
  },
  {
    name: ConnectorNames.Coinbase,
    creator: CoinbaseConnectorCreator,
    providers: [ConnectorProviders.coinbase],
  },
];

export const getConnectorCreatorByProvider = (
  provider: unknown,
): ConnectorCreator | null => {
  const connectorName = resolveConnectorNameByProvider(provider);
  if (!connectorName) {
    return null;
  }
  return connectors[connectorName] as ConnectorCreator;
};

export { spotKlineProviders } from './marketData/spotKlineProviders';
export {
  buildBybitKlineTopic,
  createBybitKlineStream,
  createBybitKlineStreamWithClient,
  parseBybitKlineEvent,
  type BybitKlineStream,
  type BybitKlineStreamEvent,
} from './ByBit/klineStream';
export {
  marketDataProviders,
  type MarketDataProvider,
  type MarketDataProviderName,
} from './marketData/providers';

export default { connectorEntries };
