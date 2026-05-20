import { getConnectorCreatorByProvider as getBuiltinConnectorCreatorByProvider } from '@tradejs/connectors';
import { getConnectorCreatorByProvider as getRegisteredConnectorCreatorByProvider } from '@tradejs/node/connectors';
import { ConnectorCreator } from '@tradejs/types';

export const DEFAULT_CONNECTOR_PROVIDER = 'bybit';

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

  if (registeredConnector) {
    return registeredConnector as ConnectorCreator;
  }

  return (
    getBuiltinConnectorCreatorByProvider(provider) ||
    getBuiltinConnectorCreatorByProvider(fallbackProvider) ||
    null
  );
};
