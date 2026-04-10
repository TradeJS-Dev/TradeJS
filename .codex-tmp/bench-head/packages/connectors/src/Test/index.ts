import { createTestConnector } from '@tradejs/node/backtest';
import { type TestConnectorCreator as TCC } from '@tradejs/types';

export const TestConnectorCreator: TCC = (connector, context) =>
  createTestConnector(connector, context);
