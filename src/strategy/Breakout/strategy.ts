import _ from 'lodash';
import { SMA, ATR, BollingerBands, OBV } from 'technicalindicators';
import { config as DEFAULT_CONFIG } from './config';
import { Strategy, StrategyCreator, StrategyConfig } from '@types';

export const BreakoutStrategyCreator: StrategyCreator = (baseConfig, data) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
  } as StrategyConfig & typeof DEFAULT_CONFIG;

  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const volumes: number[] = [];
  const obvHistory: number[] = [];

  data.forEach((item) => {
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
  const bbInstance = new BollingerBands({
    period: config.BB_PERIOD,
    values: closes,
    stdDev: config.BB_STDDEV,
  });
  const obvInstance = new OBV({ close: closes, volume: volumes });

  const smaOBVInstance = new SMA({ period: config.OBV_SMA_PERIOD, values: [] });

  const strategy: Strategy = async (symbol, candle, connector) => {
    if (_.isEmpty(candle)) return 'NO_DATA';

    const price = candle.close;
    const position = await connector.getPosition(symbol);
    const positionExists = !!position;

    closes.push(price);
    highs.push(candle.high);
    lows.push(candle.low);
    volumes.push(candle.volume);

    const { timestamp } = candle;

    const smaFast = smaFastInstance.nextValue(price);
    const smaSlow = smaSlowInstance.nextValue(price);
    const atr = atrInstance.nextValue(candle);
    const bb = bbInstance.nextValue(price);
    const obv = obvInstance.nextValue(candle);

    if (!smaFast || !smaSlow || !atr || !bb || !obv) return 'NO_INDICATORS';

    obvHistory.push(obv);
    const obvSMA = smaOBVInstance.nextValue(obv);

    const atrThreshold = atr * config.ATR_OPEN;
    const isVolatile =
      Math.abs(closes[closes.length - 1] - closes[closes.length - 2]) >
      atrThreshold;

    const highestHigh = Math.max(...highs.slice(-config.BREAKOUT_LOOKBACK));
    const lowestLow = Math.min(...lows.slice(-config.BREAKOUT_LOOKBACK));

    const breakoutHigh = price >= highestHigh;
    const breakoutLow = price <= lowestLow;

    const obvGrowing = obvSMA !== undefined && obv >= obvSMA;
    const obvFalling = obvSMA !== undefined && obv <= obvSMA;

    const qty = config.LIMIT / price;

    if (!positionExists && isVolatile) {
      if (smaFast > smaSlow && breakoutHigh && obvGrowing) {
        await connector.placeOrder(
          { symbol, qty, price, timestamp, direction: 'LONG' },
          config.TP_LONG,
          config.Sl,
        );
        return 'OPEN_LONG';
      }

      if (smaFast < smaSlow && breakoutLow && obvFalling) {
        await connector.placeOrder(
          { symbol, qty, price, timestamp, direction: 'SHORT' },
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
