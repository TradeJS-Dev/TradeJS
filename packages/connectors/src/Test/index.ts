import { createTestConnector } from '@tradejs/core/backtest';
import { type TestConnectorCreator as TCC } from '@tradejs/types';

export const TestConnectorCreator: TCC = (connector, context) =>
  createTestConnector(connector, context);
