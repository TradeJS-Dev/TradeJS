import 'dotenv/config';
import args from 'args';
import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { ConnectorNames } from '@tradejs/connectors';
import { getConnectorCreatorByName } from '@tradejs/node/connectors';
import { buildBinanceBreadthUniverseSnapshot } from '@tradejs/node/strategies';
import { selectBreadthUniverseFromTickers } from '../lib/binanceMarketData';

args.example(
  'yarn breadth:universes:update --write',
  'Refresh the versioned Binance top5/top10/top30/top50/top100 breadth snapshot',
);
args.option(
  ['w', 'write'],
  'Write the snapshot; without this flag only print the proposed update',
  false,
);
args.option(['u', 'user'], 'Connector user name', 'root');

const flags = args.parse(process.argv);

export const BINANCE_BREADTH_UNIVERSES_RELATIVE_PATH =
  'packages/node/src/config/binanceBreadthUniverses.json';

export const main = async () => {
  const projectRoot =
    String(process.env.PROJECT_CWD || process.cwd()).trim() || process.cwd();
  const connectorCreator = await getConnectorCreatorByName(
    ConnectorNames.Binance,
    projectRoot,
  );
  if (!connectorCreator) {
    throw new Error('Binance connector is not registered');
  }
  const connector = await connectorCreator({
    userName: String(flags.user || 'root'),
    universe: 'crypto',
  });
  const rankedSymbols = selectBreadthUniverseFromTickers(
    await connector.getTickers(),
    100,
  );
  const snapshot = buildBinanceBreadthUniverseSnapshot({ rankedSymbols });
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;

  console.log(
    chalk.cyan(
      `Binance breadth snapshot ${snapshot.fingerprint}: ${Object.entries(
        snapshot.universes,
      )
        .map(
          ([key, definition]) =>
            `${key}=${definition.size}:${definition.fingerprint}`,
        )
        .join(' ')}`,
    ),
  );

  if (!flags.write) {
    console.log(serialized);
    console.log(
      chalk.yellow('Dry run only. Pass --write to update the snapshot file.'),
    );
    return snapshot;
  }

  const outputPath = path.join(
    projectRoot,
    BINANCE_BREADTH_UNIVERSES_RELATIVE_PATH,
  );
  await fs.writeFile(outputPath, serialized, 'utf8');
  console.log(chalk.green(`Updated ${outputPath}`));
  return snapshot;
};
