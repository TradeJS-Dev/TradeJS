import _ from 'lodash';
import { ATR, CCI } from 'technicalindicators';
import { MOM } from '@src/indicators/mom';
import { config as DEFAULT_CONFIG } from './config';
import { Strategy, StrategyCreator, StrategyConfig, Candle } from '@types';

export const ChannelStrategyCreator: StrategyCreator = ({
  config: baseConfig,
  symbol,
  data,
  connector,
}) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
  } as StrategyConfig & typeof DEFAULT_CONFIG;

  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const candles: Candle[] = [];

  data.forEach((item) => {
    closes.push(item.close);
    highs.push(item.high);
    lows.push(item.low);
    candles.push(item);
  });

  const atrInstance = new ATR({
    period: config.ATR_PERIOD,
    high: highs,
    low: lows,
    close: closes,
  });

  const cciInstance = new CCI({
    period: config.CCI_PERIOD,
    high: highs,
    low: lows,
    close: closes,
  });

  const momInstance = new MOM({
    period: config.MOM_PERIOD,
    values: closes,
  });

  const strategy: Strategy = async (candle) => {
    if (_.isEmpty(candle)) return 'NO_DATA';

    candles.push(candle);
    closes.push(candle.close);
    highs.push(candle.high);
    lows.push(candle.low);

    const price = candle.close;
    const { timestamp } = candle;
    const qty = config.LIMIT / price;

    const position = await connector.getPosition(symbol);
    const positionExists = !_.isEmpty(position) && position.qty >= 0;
    const isLong = position?.direction === 'LONG';
    const isShort = position?.direction === 'SHORT';
    const direction = isLong ? 'LONG' : 'SHORT';

    const len = candles.length;
    if (len < config.CHANNEL_LOOKBACK + 2) return 'WAIT_DATA';

    const lookbackCandles = candles.slice(
      len - config.CHANNEL_LOOKBACK - 2,
      len - 2,
    );
    const upperBound = Math.max(...lookbackCandles.map((c) => c.high));
    const lowerBound = Math.min(...lookbackCandles.map((c) => c.low));

    const atr = atrInstance.nextValue(candle);
    const cci = cciInstance.nextValue(candle);
    const mom = momInstance.nextValue(price);

    if (!atr || !cci || mom === undefined) return 'NO_INDICATORS';

    const volatilityThreshold = atr * config.ATR_OPEN;
    const prevClose = closes[closes.length - 2];
    const priceMove = Math.abs(price - prevClose);
    const isVolatile = priceMove > volatilityThreshold;

    // Условия входа в LONG
    const longCondition =
      price <= lowerBound && isVolatile && cci < config.CCI_LOW && mom > 0;

    // Условия входа в SHORT
    const shortCondition =
      price >= upperBound && isVolatile && cci > config.CCI_HIGH && mom < 0;

    if (!positionExists) {
      if (longCondition) {
        await connector.placeOrder(
          { symbol, qty, price, timestamp, direction: 'LONG' },
          config.TP_LONG,
          config.SL_LONG,
        );
        return 'OPEN_LONG';
      }

      if (shortCondition) {
        await connector.placeOrder(
          { symbol, qty, price, timestamp, direction: 'SHORT' },
          config.TP_SHORT,
          config.SL_SHORT,
        );
        return 'OPEN_SHORT';
      }

      return 'NO_SIGNAL';
    }

    const trailingStopDistance = atr * config.ATR_CLOSE;

    if (isLong && price < position.price - trailingStopDistance) {
      await connector.closePosition({ symbol, price, timestamp, direction });
      return 'TRAILING_STOP';
    }

    if (isShort && price > position.price + trailingStopDistance) {
      await connector.closePosition({ symbol, price, timestamp, direction });
      return 'TRAILING_STOP';
    }

    return 'POSITION_HELD';
  };

  return strategy;
};
