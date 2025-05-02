export const config = {
  BB_PERIOD: 20,
  BB_STDDEV: 2,
  MIN_OBV_SLOPE: 0, // можно настроить на реальных данных
  LIMIT: 100, // USDT или другая валюта
  RISK_REWARD_RATIO: 0.3, // тейк в 3 раза больше стопа
  STOP_PERCENT: 0.01, // 1% стоп
  tpl: [
    // {
    //   rate: 0.3,
    //   profit: 0.05,
    // },
    // {
    //   rate: 0.3,
    //   profit: 0.1,
    // },
    // {
    //   rate: 0.3,
    //   profit: 0.15,
    // },
  ],
};
