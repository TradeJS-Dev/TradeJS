import { resolveTradingAccount } from '@tradejs/infra/tradingAccounts';
import { getConnectorCreatorByProvider as getRegisteredConnectorCreatorByProvider } from '@tradejs/node/connectors';
import { ConnectorCreator, MarketUniverse } from '@tradejs/types';

export const DEFAULT_CONNECTOR_PROVIDER = 'bybit';

export const resolveConnectorAccountId = async ({
  userName,
  provider,
  universe,
}: {
  userName: string;
  provider: string;
  universe: MarketUniverse;
}) => {
  const account = await resolveTradingAccount({
    userName,
    provider,
    universe,
  });

  return account?.id;
};

export const resolveConnectorCreatorByProvider = async (
  provider: string,
  projectRoot: string,
  fallbackProvider = DEFAULT_CONNECTOR_PROVIDER,
): Promise<ConnectorCreator | null> => {
  const registeredConnector =
    (await getRegisteredConnectorCreatorByProvider(provider, projectRoot)) ||
    (await getRegisteredConnectorCreatorByProvider(
      fallbackProvider,
      projectRoot,
    ));

  return (registeredConnector as ConnectorCreator | null) ?? null;
};
