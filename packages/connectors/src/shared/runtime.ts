import type { ConnectorLogger, ConnectorRuntime } from '@tradejs/types';

const noop = () => undefined;

export const silentConnectorLogger: ConnectorLogger = {
  log: noop,
  info: noop,
  warn: noop,
  error: noop,
};

export const getConnectorLogger = (
  runtime?: ConnectorRuntime,
): ConnectorLogger => runtime?.logger ?? silentConnectorLogger;

export const getConnectorAccountResolver = (runtime?: ConnectorRuntime) =>
  runtime?.resolveTradingAccount ?? (async () => null);

export const decorateConnectorKline = (
  runtime: ConnectorRuntime | undefined,
  options: Parameters<ConnectorRuntime['createCachedKline']>[0],
) => runtime?.createCachedKline(options) ?? options.request;
