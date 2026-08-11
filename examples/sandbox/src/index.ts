export {
  strategyEntries,
  STRATEGY_NAME,
  createSandboxDeterministicCore,
} from './plugins/sandboxStrategy.plugin';
export { indicatorEntries } from './plugins/sandboxIndicator.plugin';
export {
  connectorEntries,
  SandboxMockConnectorCreator,
  SANDBOX_TICKER_SYMBOL,
  BTC_TICKER_SYMBOL,
} from './plugins/sandboxConnector.plugin';

import { connectorEntries } from './plugins/sandboxConnector.plugin';
import { indicatorEntries } from './plugins/sandboxIndicator.plugin';
import { strategyEntries } from './plugins/sandboxStrategy.plugin';

export default {
  strategyEntries,
  indicatorEntries,
  connectorEntries,
};
