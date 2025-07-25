import { ByBitConnectorCreator } from './ByBit';
import { TestConnectorCreator } from './Test';

export enum ConnectorNames {
  ByBit = 'ByBit',
  Test = 'Test',
}

export const connectors = {
  [ConnectorNames.ByBit]: ByBitConnectorCreator,
  [ConnectorNames.Test]: TestConnectorCreator,
} as const;
