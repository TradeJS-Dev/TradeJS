import { ByBitConnectorCreator } from './ByBit';
import { TestConnectorCreator } from './Test';

export enum ConnectorNames {
  bybit = 'bybit',
  test = 'test',
};

export const connectors = {
  [ConnectorNames.bybit]: ByBitConnectorCreator,
  [ConnectorNames.test]: TestConnectorCreator,
} as const;
