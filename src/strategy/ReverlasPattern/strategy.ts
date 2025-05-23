import _ from 'lodash';
import {
  SMA,
  ATR,
  OBV,
  bullishengulfingpattern,
  bearishengulfingpattern,
  morningstar,
  eveningstar,
  threewhitesoldiers,
  threeblackcrows,
  piercingline,
  darkcloudcover,
  hammerpattern,
  shootingstar,
} from 'technicalindicators';
import { config as DEFAULT_CONFIG } from './config';
import { Strategy, StrategyCreator, StrategyConfig } from '@types';

export const ReversalPatternStrategyCreator: StrategyCreator = (
  baseConfig,
  data,
) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
  } as StrategyConfig & typeof DEFAULT_CONFIG;

  const opens: number[] = [];
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];

  data.forEach((item) => {
    opens.push(item.open);
    closes.push(item.close);
    highs.push(item.high);
    lows.push(item.low);
    volumes.push(item.volume);
  });

  const smaFastInstance = new SMA({
    period: config.MA_FAST,
    values: closes,
  });
  const smaSlowInstance = new SMA({
    period: config.MA_SLOW,
    values: closes,
  });
  const atrInstance = new ATR({
    period: config.ATR_PERIOD,
    high: highs,
    low: lows,
    close: closes,
  });

  const obvInstance = new OBV({ close: closes, volume: volumes });

  const strategy: Strategy = async (symbol, candle, connector) => {
    if (_.isEmpty(candle)) return 'NO_DATA';

    const price = candle.close;
    const position = await connector.getPosition(symbol);
    const positionExists = !!position;

    opens.push(candle.open);
    highs.push(candle.high);
    lows.push(candle.low);
    closes.push(candle.close);
    volumes.push(candle.volume);

    const { timestamp } = candle;
    const smaFast = smaFastInstance.nextValue(candle.close);
    const smaSlow = smaSlowInstance.nextValue(candle.close);
    const atr = atrInstance.nextValue(candle);
    const obv = obvInstance.nextValue(candle);

    if (!smaFast || !smaSlow || !atr || !obv) return 'NO_INDICATORS';

    const patternInput = {
      open: opens.slice(-5),
      high: highs.slice(-5),
      low: lows.slice(-5),
      close: closes.slice(-5),
    };

    // Проверка паттернов
    const isBullish =
      bullishengulfingpattern(patternInput) ||
      morningstar(patternInput) ||
      threewhitesoldiers(patternInput) ||
      piercingline(patternInput) ||
      hammerpattern(patternInput);

    const isBearish =
      bearishengulfingpattern(patternInput) ||
      eveningstar(patternInput) ||
      threeblackcrows(patternInput) ||
      darkcloudcover(patternInput) ||
      shootingstar(patternInput);

    const atrThreshold = atr * config.ATR_OPEN;
    const isVolatile =
      Math.abs(closes[closes.length - 1] - closes[closes.length - 2]) >
      atrThreshold;

    const obvChange =
      obv -
      (OBV.calculate({
        close: closes.slice(0, -1),
        volume: volumes.slice(0, -1),
      }).pop() || 0);
    const obvGrowing = obvChange > 0;
    const obvFalling = obvChange < 0;

    const qty = config.LIMIT / price;

    if (!positionExists && isVolatile) {
      if (isBullish && smaFast > smaSlow && obvGrowing) {
        await connector.placeOrder(
          {
            symbol,
            qty,
            price,
            timestamp,
            direction: 'LONG',
          },
          config.TP_LONG,
          config.Sl,
        );
        return 'OPEN_LONG';
      }

      if (isBearish && smaFast < smaSlow && obvFalling) {
        await connector.placeOrder(
          {
            symbol,
            qty,
            price,
            timestamp,
            direction: 'SHORT',
          },
          config.TP_SHORT,
          config.Sl,
        );
        return 'OPEN_SHORT';
      }

      return 'NO_SIGNAL';
    }

    if (positionExists) {
      const isLong = position.direction === 'LONG';
      const isShort = position.direction === 'SHORT';
      const direction = isLong ? 'LONG' : 'SHORT';

      if ((isLong && smaFast < smaSlow) || (isShort && smaFast > smaSlow)) {
        await connector.closePosition({ symbol, price, timestamp, direction });
        return 'CLOSE_POSITION';
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
    }

    return 'NO_SIGNAL';
  };

  return strategy;
};
