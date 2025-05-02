import _ from 'lodash';
import { BollingerBands, OBV } from 'technicalindicators';
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
      interval: '15', // 15m таймфрейм
      end: timestamp,
    });
  
    if (_.isEmpty(data)) return;
  
    const closes = data.map((d) => d.close);
    const volumes = data.map((d) => d.volume);
  
    const bb = BollingerBands.calculate({
      period: config.BB_PERIOD,
      stdDev: config.BB_STDDEV,
      values: closes,
    }).pop();
  
    if (!bb) return;
  
    const price = closes[closes.length - 1];
  
    // Рассчитаем OBV (на последней свече)
    const obv = OBV.calculate({
      close: closes,
      volume: volumes,
    });
  
    const obvSlope = obv[obv.length - 1] - obv[obv.length - 5]; // прирост за 5 свечей
  
    const position = await connector.getPosition(symbol);
    const positionExists = !!position;
  
    // Условие на пробой вверх
    if (!positionExists && price > bb.upper && obvSlope > config.MIN_OBV_SLOPE) {
      const qty = config.LIMIT / price;
      const stopLoss = price * (1 - config.STOP_PERCENT);
      const takeProfit = price + (price - stopLoss) * config.RISK_REWARD_RATIO;
  
      await connector.placeOrder(
        {
          symbol,
          qty,
          price,
          timestamp,
        },
        [
          // { profit: takeProfit, rate: config.RISK_REWARD_RATIO },
          // { profit: stopLoss, rate: -1 },
        ],
      );
      console.log(`[${symbol}] LONG entry at ${price}, TP: ${takeProfit}, SL: ${stopLoss}`);
    }
  
    // Условие выхода (если цена вернулась ниже средней линии Bollinger)
    if (positionExists && price < bb.middle) {
      await connector.closePosition({
        symbol,
        price,
        timestamp,
      });
      console.log(`[${symbol}] Position closed at ${price}`);
    }
  };
  
  return strategy;
};
