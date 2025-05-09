import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import prettier from 'prettier';
import { ByBitConnectorCreator } from '@src/connectors/ByBit';
import { getTimestamp } from '@utils/timestamp';

const DAYS = 90;

const start = getTimestamp(DAYS);
const end = getTimestamp();
const INTERVAL = '5';

const LIST = [
  'BTCUSDT',
  'ETHUSDT',
  'NEARUSDT',
  'MATICUSDT',
  'OPUSDT',
  'APTUSDT',
  'AVAXUSDT',
  'SOLUSDT',
  'SUIUSDT',
  'SEIUSDT',
  'TIAUSDT',
  'DYDXUSDT',
  'DYMUSDT',
];

const render = async () => {
  const content = await ejs.renderFile(
    path.resolve(process.cwd(), 'src/templates/data.ejs'),
    {
      dataFiles: LIST.map((symbol) => `${symbol}_${INTERVAL}`),
    },
  );

  const formatted = await prettier.format(content, {
    singleQuote: true,
    trailingComma: 'all',
    parser: 'typescript',
  });

  fs.writeFileSync(
    path.resolve(process.cwd(), 'src/utils/data.ts'),
    formatted,
    'utf-8',
  );
};

const update = async () => {
  const byBitConnector = ByBitConnectorCreator({
    key: '',
    secret: '',
  });

  for await (const symbol of LIST) {
    await byBitConnector.kline({
      symbol,
      interval: INTERVAL,
      start,
      end,
    });
  }

  await render();
};

update();
