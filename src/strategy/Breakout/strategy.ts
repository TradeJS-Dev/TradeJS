import _ from 'lodash';
import { SMA, ATR, BollingerBands, OBV } from 'technicalindicators';
import { config as DEFAULT_CONFIG } from './config';
import { Strategy, StrategyCreator, StrategyConfig } from '@types';

export const BreakoutStrategyCreator: StrategyCreator = (baseConfig) => {
  const config = {
    ...DEFAULT_CONFIG,
    ...baseConfig,
  } as StrategyConfig & typeof DEFAULT_CONFIG;

  const strategy: Strategy = async (symbol, timestamp, connector) => {
    const data = await connector.kline({
      symbol,
      interval: config.INTERVAL,
      end: timestamp,
    });

    if (_.isEmpty(data)) return 'NO_DATA';

    const closes: number[] = [];
    const highs: number[] = [];
    const lows: number[] = [];
    const volumes: number[] = [];

    data.forEach((item) => {
      closes.push(item.close);
      highs.push(item.high);
      lows.push(item.low);
      volumes.push(item.volume);
    });

    const price = closes[closes.length - 1];
    const position = await connector.getPosition(symbol);
    const positionExists = !!position;

    const smaFast = SMA.calculate({
      period: config.MA_FAST,
      values: closes,
    }).pop();
    const smaSlow = SMA.calculate({
      period: config.MA_SLOW,
      values: closes,
    }).pop();
    const atr = ATR.calculate({
      period: config.ATR_PERIOD,
      high: highs,
      low: lows,
      close: closes,
    }).pop();
    const bb = BollingerBands.calculate({
      period: config.BB_PERIOD,
      values: closes,
      stdDev: config.BB_STDDEV,
    }).pop();
    const obv = OBV.calculate({ close: closes, volume: volumes }).pop();

    if (!smaFast || !smaSlow || !atr || !bb || !obv) return 'NO_INDICATORS';

    // === Фильтры ===
    const atrThreshold = atr * config.ATR_OPEN;
    const isVolatile =
      Math.abs(closes[closes.length - 1] - closes[closes.length - 2]) >
      atrThreshold;

    const priceAboveUpperBB = price > bb.upper;
    const priceBelowLowerBB = price < bb.lower;

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
      if (smaFast > smaSlow && priceAboveUpperBB && obvGrowing) {
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

      if (smaFast < smaSlow && priceBelowLowerBB && obvFalling) {
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

      // Выход по обратному сигналу
      if ((isLong && smaFast < smaSlow) || (isShort && smaFast > smaSlow)) {
        await connector.closePosition({
          symbol,
          price,
          timestamp,
          direction,
        });
        return 'CLOSE_POSITION';
      }

      // Трейлинг-стоп (упрощённый)
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
