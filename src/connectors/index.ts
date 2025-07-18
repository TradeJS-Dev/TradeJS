import { ByBitConnectorCreator } from './ByBit';
import { TestConnectorCreator } from './Test';

export enum ConnectorNames {
  Bybit = 'Bybit',
  Test = 'Test',
}

export const connectors = {
  [ConnectorNames.Bybit]: ByBitConnectorCreator,
  [ConnectorNames.Test]: TestConnectorCreator,
} as const;
