import 'dotenv/config';
import { connectors } from '@tradejs/connectors';
import { Connector } from '@tradejs/types';

const getPositions = async (connector: Connector) => {
  const res = await connector.getPositions();

  console.log('res', res);
};

export const main = async () => {
  const byBitConnector = await connectors.ByBit({
    userName: 'root',
  });

  await getPositions(byBitConnector);
};
