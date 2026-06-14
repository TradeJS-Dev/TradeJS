import chalk from 'chalk';
import { ConnectorNames } from '@tradejs/connectors';
import { update } from '@tradejs/node/cli';
import { getConnectorCreatorByName } from '@tradejs/node/connectors';
import type { Connector, ConnectorCreator, Interval } from '@tradejs/types';
import { timeOperation as runTimedOperation } from '../runFormatting';

export type BtcReferenceConnectors = {
  binance: Connector;
  coinbase: Connector;
};

const withPrimaryMarketReferenceSymbols = (symbols: string[]) => [
  ...new Set([...symbols, 'ETHUSDT']),
];

export const loadBtcReferenceConnectors = async ({
  connectorName,
  marketConnector,
  userName,
  projectRoot,
  shouldUseDedicatedReferences,
  requireDedicatedReferences = false,
  warn,
}: {
  connectorName: string;
  marketConnector: Connector;
  userName: string;
  projectRoot: string;
  shouldUseDedicatedReferences: boolean;
  requireDedicatedReferences?: boolean;
  warn: (message: string) => void;
}): Promise<BtcReferenceConnectors> => {
  if (!shouldUseDedicatedReferences) {
    return {
      binance: marketConnector,
      coinbase: marketConnector,
    };
  }

  const [binanceFactory, coinbaseFactory] = await Promise.all([
    getConnectorCreatorByName(ConnectorNames.Binance, projectRoot),
    getConnectorCreatorByName(ConnectorNames.Coinbase, projectRoot),
  ]);

  const binance = binanceFactory
    ? await (binanceFactory as ConnectorCreator)({ userName })
    : marketConnector;
  if (!binanceFactory) {
    if (requireDedicatedReferences) {
      throw new Error('Binance connector is required for BTC reference data');
    }
    warn(`Binance connector is unavailable. Reusing ${connectorName}.`);
  }

  const coinbase = coinbaseFactory
    ? await (coinbaseFactory as ConnectorCreator)({ userName })
    : marketConnector;
  if (!coinbaseFactory) {
    if (requireDedicatedReferences) {
      throw new Error('Coinbase connector is required for BTC reference data');
    }
    warn(`Coinbase connector is unavailable. Reusing ${connectorName}.`);
  }

  return { binance, coinbase };
};

export const updateMarketHistoryWithBtcReferences = async ({
  marketConnector,
  connectorName,
  btcReferences,
  interval,
  symbols,
  preloadDays,
  preloadStart,
  preloadEnd,
  log,
}: {
  marketConnector: Connector;
  connectorName: string;
  btcReferences: BtcReferenceConnectors;
  interval: Interval;
  symbols: string[];
  preloadDays?: number;
  preloadStart?: number;
  preloadEnd?: number;
  log?: (message: string) => void;
}) => {
  const timeOperation = <T>(label: string, operation: () => Promise<T>) =>
    runTimedOperation(
      label,
      operation,
      log ?? ((message) => console.log(chalk.gray(message))),
    );
  const updateOptions =
    preloadStart != null || preloadEnd != null
      ? {
          connectorLabel: connectorName,
          ...(preloadStart != null ? { preloadStart } : {}),
          ...(preloadEnd != null ? { preloadEnd } : {}),
        }
      : { connectorLabel: connectorName };

  await timeOperation(`update ${connectorName}`, () =>
    update(
      marketConnector,
      interval,
      withPrimaryMarketReferenceSymbols(symbols),
      preloadDays,
      updateOptions,
    ),
  );

  const updateReference = async ({
    connector,
    connectorLabel,
  }: {
    connector: Connector;
    connectorLabel: ConnectorNames;
  }) => {
    if (connector === marketConnector) {
      return;
    }

    const referenceOptions =
      preloadStart != null || preloadEnd != null
        ? {
            connectorLabel,
            ...(preloadStart != null ? { preloadStart } : {}),
            ...(preloadEnd != null ? { preloadEnd } : {}),
          }
        : { connectorLabel };

    await timeOperation(`update ${connectorLabel}`, () =>
      update(connector, interval, ['BTCUSDT'], preloadDays, referenceOptions),
    );
  };

  await updateReference({
    connector: btcReferences.binance,
    connectorLabel: ConnectorNames.Binance,
  });
  await updateReference({
    connector: btcReferences.coinbase,
    connectorLabel: ConnectorNames.Coinbase,
  });
};
