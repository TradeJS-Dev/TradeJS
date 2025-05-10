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

    if (_.isEmpty(data)) return;

    const closes = data.map((d) => d.close);
    const highs = data.map((d) => d.high);
    const lows = data.map((d) => d.low);
    const volumes = data.map((d) => d.volume);

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

    if (!smaFast || !smaSlow || !atr || !bb || !obv) return;

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
      // Лонг
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
      }

      // // Шорт
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
      }
    }

    if (positionExists) {
      const isLong = position.direction === 'LONG';
      const isShort = position.direction === 'SHORT';

      // Выход по обратному сигналу
      if ((isLong && smaFast < smaSlow) || (isShort && smaFast > smaSlow)) {
        await connector.closePosition({
          symbol,
          price,
          timestamp,
        });
      }

      // Трейлинг-стоп (упрощённый)
      const trailingStopDistance = atr * config.ATR_CLOSE;

      if (isLong && price < position.price - trailingStopDistance) {
        await connector.closePosition({ symbol, price, timestamp });
      }

      if (isShort && price > position.price + trailingStopDistance) {
        await connector.closePosition({ symbol, price, timestamp });
      }
    }
  };

  return strategy;
};
