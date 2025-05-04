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
      interval: '5',
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
  
    const smaFast = SMA.calculate({ period: 9, values: closes }).pop();
    const smaSlow = SMA.calculate({ period: 21, values: closes }).pop();
    const atr = ATR.calculate({ period: 14, high: highs, low: lows, close: closes }).pop();
    const bb = BollingerBands.calculate({
      period: 20,
      values: closes,
      stdDev: 2,
    }).pop();
    const obv = OBV.calculate({ close: closes, volume: volumes }).pop();
  
    if (!smaFast || !smaSlow || !atr || !bb || !obv) return;
  
    // === Фильтры ===
    const atrThreshold = atr * 0.5;
    const isVolatile = Math.abs(closes[closes.length - 1] - closes[closes.length - 2]) > atrThreshold;
  
    const priceAboveUpperBB = price > bb.upper;
    const priceBelowLowerBB = price < bb.lower;
  
    const obvChange = obv - (OBV.calculate({ close: closes.slice(0, -1), volume: volumes.slice(0, -1) }).pop() || 0);
    const obvGrowing = obvChange > 0;
    const obvFalling = obvChange < 0;
  
    const qty = config.LIMIT / price;
  
    if (!positionExists && isVolatile) {
      // Лонг
      if (smaFast > smaSlow && priceAboveUpperBB && obvGrowing) {
        await connector.placeOrder({
          symbol,
          qty,
          price,
          timestamp,
        }, [
          { profit: 0.01, rate: 0.25 },
          { profit: 0.02, rate: 0.5 },
        ]);
      }
  
      // // Шорт
      // if (smaFast < smaSlow && priceBelowLowerBB && obvFalling) {
      //   await connector.placeOrder({
      //     symbol,
      //     qty,
      //     price,
      //     timestamp,
      //   }, [
      //     { profit: 0.01, rate: 0.25 },
      //     { profit: 0.02, rate: 0.5 },
      //   ]);
      // }
    }
  
    if (positionExists) {
      // Выход по обратному сигналу
      if ((position.qty > 0 && smaFast < smaSlow) || (position.qty < 0 && smaFast > smaSlow)) {
        await connector.closePosition({
          symbol,
          price,
          timestamp,
        });
      }
  
      // Трейлинг-стоп (упрощённый)
      const trailingStopDistance = atr * 1.5;
      const isLong = position.qty > 0;
      const isShort = position.qty < 0;
  
      if (isLong && price < position.price - trailingStopDistance) {
        await connector.closePosition({ symbol, price, timestamp });
      }
  
      // if (isShort && price > position.price + trailingStopDistance) {
      //   await connector.closePosition({ symbol, price, timestamp });
      // }
    }
  };
  
  return strategy;
};
