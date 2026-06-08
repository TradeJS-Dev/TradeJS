import {
  startOfMonth,
  endOfMonth,
  addMonths,
  differenceInMilliseconds,
} from 'date-fns';

import {
  PositionLogData,
  TestStat,
  ThresholdLevel,
  TestThresholdsKey,
  TestWorkerResult,
  MonthlyEquityStats,
  EOMPoint,
} from '@tradejs/types';
import { TestThresholdsConfig } from '../constants';
import { round, absReturns, relReturns, equityPoints, mean, sum } from './math';

/**
 * Максимальные стрики побед/поражений по абсолютным ретёрнам на сделку.
 * Нулевая сделка (r===0) сбрасывает обе серии.
 */
const calcStreaks = (retsAbs: number[]) => {
  let maxW = 0,
    maxL = 0,
    cw = 0,
    cl = 0;
  for (const r of retsAbs) {
    if (r > 0) {
      cw++;
      cl = 0;
      if (cw > maxW) maxW = cw;
    } else if (r < 0) {
      cl++;
      cw = 0;
      if (cl > maxL) maxL = cl;
    } else {
      // r === 0 → сброс обеих серий
      cw = 0;
      cl = 0;
    }
  }
  return { maxConsecutiveWins: maxW, maxConsecutiveLosses: maxL };
};

/**
 * Максимальная просадка (Max Drawdown) в процентах от бегающего пика.
 * Формула по точкам amount_t:
 *   peak_t = max(amount_0..t)
 *   drawdown_t = (peak_t - amount_t) / peak_t * 100
 *   MaxDD = max_t(drawdown_t)
 * Ожидается, что amounts — это последовательные значения equity и > 0.
 */
export const calculateMaxDrawdown = (amounts: number[]): number => {
  let max = amounts[0];
  let maxDrawdown = 0;

  for (const amount of amounts) {
    if (amount > max) {
      max = amount; // обновляем пик
    }
    const drawdown = ((max - amount) / max) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
};

/**
 * Считает помесячные доходности по equity на концах месяцев (EOM) и производные метрики.
 * Заполняет «пустые» месяцы переносом последнего известного amount (даёт 0% в такие месяцы).
 *
 * @param positionLogData Логи позиций (timestamps предполагаются в ms, если opts.tsUnit='ms')
 * @param opts.mar Минимально приемлемая доходность в месяц (MAR), доля. Часто берут 0.
 * @param opts.sampleStd Если true — выборочное std (деление на N-1), иначе population (деление на N).
 * @param opts.tsUnit 'ms' | 's' — единицы timestamps во входных данных.
 *
 * Возвращает:
 *  - eomSeries: массив точек конца месяцев с equity
 *  - monthlyReturns: ряд месячных ретёрнов r_t = EOM_t / EOM_{t-1} - 1 (доли)
 *  - monthlyMean, monthlyStd: арифм. среднее и std по месячной серии (population/sample)
 *  - monthlyDownsideStd: std ниже MAR (для Sortino)
 *  - sharpeMonthly, sharpeMonthlyAnnualized: месячный и годовой Sharpe по месячной серии
 *  - sortinoMonthly, sortinoMonthlyAnnualized: месячный и годовой Sortino по месячной серии
 *  - positiveMonths, maxMonthlyGain, maxMonthlyDrop: доп. характеристики ряда
 */
const computeMonthlyEquityStats = (
  positionLogData: PositionLogData,
  opts?: { mar?: number; sampleStd?: boolean; tsUnit?: 'ms' | 's' },
): MonthlyEquityStats => {
  const MAR = opts?.mar ?? 0;
  const useSample = !!opts?.sampleStd;
  const tsMul = (opts?.tsUnit ?? 'ms') === 's' ? 1000 : 1;

  if (!positionLogData.length) {
    return {
      eomSeries: [],
      monthlyReturns: [],
      monthlyMean: 0,
      monthlyStd: 0,
      monthlyDownsideStd: 0,
      sharpeMonthly: null,
      sharpeMonthlyAnnualized: null,
      sortinoMonthly: null,
      sortinoMonthlyAnnualized: null,
      positiveMonths: 0,
      maxMonthlyGain: 0,
      maxMonthlyDrop: 0,
    };
  }

  // 1) Строим точки equity (open/close) и сортируем по времени.
  //    Умножаем timestamps на tsMul, если исходно были секунды.
  const equityPoints = positionLogData
    .flatMap((p) => [
      { ts: p.open.timestamp * tsMul, amount: p.open.amount },
      { ts: p.close.timestamp * tsMul, amount: p.close.amount },
    ])
    .sort((a, b) => a.ts - b.ts);

  const startTs = equityPoints[0].ts;
  const endTs = equityPoints[equityPoints.length - 1].ts;

  // 2) EOM-ряд: для каждого конца месяца берём последний известный amount.
  //    Это даёт стабильный помесячный ряд даже при «дырах» между сделками.
  const eomSeries: EOMPoint[] = [];
  let monthCursor = startOfMonth(new Date(startTs));
  const lastMonth = endOfMonth(new Date(endTs));
  let i = 0;
  let lastAmount = equityPoints[0].amount;

  while (monthCursor <= lastMonth) {
    const eom = endOfMonth(monthCursor);
    const eomTs = eom.getTime();

    // Продвигаем индекс точек equity до конца месяца,
    // сохраняя последний встретившийся amount.
    while (i < equityPoints.length && equityPoints[i].ts <= eomTs) {
      lastAmount = equityPoints[i].amount;
      i += 1;
    }

    // Ключ месяца в формате YYYY-MM
    const key = `${eom.getFullYear()}-${String(eom.getMonth() + 1).padStart(2, '0')}`;
    eomSeries.push({ month: key, ts: eomTs, amount: lastAmount });
    monthCursor = addMonths(monthCursor, 1);
  }

  // 3) Месячные ретёрны: r_t = EOM_t / EOM_{t-1} - 1 (доли).
  const monthlyReturns: number[] = [];
  for (let k = 1; k < eomSeries.length; k++) {
    const prev = eomSeries[k - 1].amount;
    const curr = eomSeries[k].amount;
    monthlyReturns.push(prev > 0 ? curr / prev - 1 : 0);
  }

  // 4) Агрегаты по месячной серии: среднее, std (population/sample),
  //    downside std относительно MAR.
  const n = monthlyReturns.length;
  const monthlyMean = n ? monthlyReturns.reduce((a, b) => a + b, 0) / n : 0;

  const variance = n
    ? monthlyReturns.reduce((a, v) => a + (v - monthlyMean) ** 2, 0) /
      (useSample && n > 1 ? n - 1 : n)
    : 0;
  const monthlyStd = Math.sqrt(variance);

  // Downside-отклонения от MAR: берём только отрицательные части (r - MAR < 0).
  const downside = monthlyReturns
    .map((r) => Math.min(r - MAR, 0))
    .filter((v) => v < 0);
  const nd = downside.length;
  const downsideVar = nd
    ? downside.reduce((a, v) => a + v * v, 0) /
      (useSample && nd > 1 ? nd - 1 : nd)
    : 0;
  const monthlyDownsideStd = Math.sqrt(downsideVar);

  // Sharpe/Sortino по месячному ряду (в долях),
  // годовые версии масштабируются на sqrt(12).
  const sharpeMonthly =
    monthlyStd > 0 ? (monthlyMean - MAR) / monthlyStd : null;
  const sortinoMonthly =
    monthlyDownsideStd > 0 ? (monthlyMean - MAR) / monthlyDownsideStd : null;

  const sharpeMonthlyAnnualized =
    sharpeMonthly === null ? null : sharpeMonthly * Math.sqrt(12);
  const sortinoMonthlyAnnualized =
    sortinoMonthly === null ? null : sortinoMonthly * Math.sqrt(12);

  // Доп. характеристики помесячного ряда
  const positiveMonths = monthlyReturns.filter((r) => r > 0).length;
  const maxMonthlyGain = n ? Math.max(...monthlyReturns) : 0;
  const maxMonthlyDrop = n ? Math.min(...monthlyReturns) : 0;

  return {
    eomSeries,
    monthlyReturns,
    monthlyMean,
    monthlyStd,
    monthlyDownsideStd,
    sharpeMonthly,
    sharpeMonthlyAnnualized,
    sortinoMonthly,
    sortinoMonthlyAnnualized,
    positiveMonths,
    maxMonthlyGain,
    maxMonthlyDrop,
  };
};

/**
 * Рассчитывает компактный набор действительно полезных метрик:
 * - Период и частота (periodDays/Months, trades, tradesPerMonth, exposure)
 * - Доходность (final amount, netProfit, totalReturn %, CAGR %)
 * - Риск (MaxDD %) и Calmar (CAGR / MaxDD)
 * - Качество сделок (winRate %, payoff, expectancyPerTrade %, streaks)
 * - Sharpe (годовой) — по месячным ретёрнам equity (EOM)
 *
 * Возвратные проценты (totalReturn, cagr, exposure, maxDrawdown, expectancyPerTrade) — уже в %.
 * Шарп — безразмерная величина (annualized).
 */
export const calculateStatsFull = (
  positionLogData: PositionLogData,
): TestStat | null => {
  if (!positionLogData.length) return null;

  // Базовые ряды: абсолютные/относительные ретёрны на сделку и временной ряд equity.
  const retsAbs = absReturns(positionLogData);
  const retsRel = relReturns(positionLogData);
  const points = equityPoints(positionLogData);
  const startTs = points[0].ts;
  const endTs = points[points.length - 1].ts;

  // -------- Период и частота --------
  // Надёжная разница во времени с использованием date-fns
  const periodMs = differenceInMilliseconds(new Date(endTs), new Date(startTs));
  const periodDays = periodMs / (1000 * 60 * 60 * 24);
  const periodMonths = periodDays / 30.4375; // средняя длина календарного месяца
  const trades = positionLogData.length; // кол-во закрытых сделок
  const tradesPerMonth = periodMonths > 0 ? trades / periodMonths : 0;

  // Экспозиция: доля времени «в рынке» (сумма длительностей позиций / весь период).
  const durations = positionLogData.map(
    (p) => p.close.timestamp - p.open.timestamp,
  );
  const totalTime = endTs - startTs;
  const exposure = totalTime > 0 ? (sum(durations) / totalTime) * 100 : 0;

  // -------- Доходность --------
  const initialAmount = points[0].amount;
  const finalAmount = points[points.length - 1].amount;
  const netProfit = finalAmount - initialAmount;
  const totalReturn =
    initialAmount > 0 ? (finalAmount / initialAmount - 1) * 100 : 0;

  // CAGR — годовая геометрическая доходность из всего периода (в %).
  const cagr =
    periodMonths > 0 && initialAmount > 0
      ? (Math.pow(finalAmount / initialAmount, 12 / periodMonths) - 1) * 100
      : 0;

  // -------- Риск и Calmar --------
  const allAmounts = points.map((p) => p.amount);
  // Предполагается, что calculateMaxDrawdown возвращает %.
  const maxDrawdown = calculateMaxDrawdown(allAmounts);
  const calmar = maxDrawdown > 0 ? cagr / maxDrawdown : null;

  // -------- Качество сделок --------
  const wins = retsAbs.filter((x) => x > 0).length;
  const losses = retsAbs.filter((x) => x <= 0).length;
  const winRate = trades ? (wins / trades) * 100 : 0;

  // Payoff = средний выигрыш / средний проигрыш (в абсолютном выражении, напр. $).
  const avgWinAbs = mean(retsAbs.filter((x) => x > 0));
  const avgLossAbs = Math.abs(mean(retsAbs.filter((x) => x < 0)));
  const payoff = avgLossAbs > 0 ? avgWinAbs / avgLossAbs : null;

  // Ожидаемая доходность на сделку (в %) из относительных ретёрнов:
  // E[r] = p(win)*avg_win_rel - p(loss)*avg_loss_rel
  const avgWinRel = mean(retsRel.filter((x) => x > 0)); // доли
  const avgLossRel = Math.abs(mean(retsRel.filter((x) => x < 0))); // доли
  const pWin = trades ? wins / trades : 0;
  const expectancyPerTrade = (pWin * avgWinRel - (1 - pWin) * avgLossRel) * 100;

  // Стрики
  const { maxConsecutiveWins, maxConsecutiveLosses } = calcStreaks(retsAbs);

  // -------- Sharpe (временной) --------
  // Берём месячные ретёрны по equity (EOM), считаем месячный Sharpe и масштабируем к годовому.
  const monthly = computeMonthlyEquityStats(positionLogData, {
    mar: 0, // MAR=0, при желании можно параметризовать
    sampleStd: false, // population std
    tsUnit: 'ms', // timestamps в миллисекундах
  });
  const sharpe =
    (monthly.sharpeMonthly ?? null) !== null
      ? monthly.sharpeMonthly! * Math.sqrt(12)
      : null;

  // -------- Результат --------
  const res = {
    // Период и частота
    periodDays: round(periodDays),
    periodMonths: round(periodMonths),
    orders: trades,
    wins,
    losses,
    ordersPerMonth: round(tradesPerMonth),
    exposure: round(exposure),

    // Доходность
    amount: round(finalAmount),
    maxAmount: round(Math.max(...allAmounts)),
    minAmount: round(Math.min(...allAmounts)),
    netProfit: round(netProfit),
    totalReturn: round(totalReturn),
    cagr: round(cagr),

    // Риск и Calmar
    maxDrawdown: round(maxDrawdown),
    calmar: calmar === null ? null : round(calmar),

    // Качество сделок
    winRate: round(winRate),
    riskRewardRatio: payoff === null ? null : round(payoff),
    expectancy: round(expectancyPerTrade),
    maxConsecutiveWins,
    maxConsecutiveLosses,

    // Sharpe (годовой) по месячным ретёрнам equity
    sharpeRatio: sharpe === null ? null : round(sharpe),
  };

  const score = getBacktestScore(res);

  return {
    ...res,
    score,
  };
};

export const classifyMetric = (
  name: TestThresholdsKey,
  value: number,
): ThresholdLevel => {
  const { thresholds, direction, neutralValue } = TestThresholdsConfig[name];

  if (neutralValue !== undefined && value === neutralValue) {
    return 'neutral';
  }

  if (direction === 'higher') {
    if (value >= thresholds[1]) return 'success';
    if (value >= thresholds[0]) return 'warning';
    return 'error';
  } else {
    if (value <= thresholds[1]) return 'success';
    if (value <= thresholds[0]) return 'warning';
    return 'error';
  }
};

export const getBacktestScore = (stat: Partial<TestStat>): number => {
  if (!stat) {
    return 0;
  }

  const netProfit = Number(stat.netProfit ?? 0);
  const winRate = Number(stat.winRate ?? 0);

  if (!Number.isFinite(netProfit) || !Number.isFinite(winRate)) {
    return 0;
  }

  return Math.round(netProfit * winRate);
};

export const sortBestTests = (
  results: TestWorkerResult[],
  limit: number = 5,
): TestWorkerResult[] => {
  return results
    .sort((a, b) => (b.stat.amount ?? 0) - (a.stat.amount ?? 0))
    .slice(0, limit);
};

export const getFormatted = (
  stat: Partial<TestStat> | undefined,
  key: TestThresholdsKey,
) => {
  if (!stat) {
    return {
      formatted: '0',
      level: 'error' as ThresholdLevel,
    };
  }

  const raw = stat[key];

  if (raw == null || typeof raw === 'string') {
    return {
      formatted: String(raw ?? '-'),
      level: 'error' as ThresholdLevel,
    };
  }

  const config = TestThresholdsConfig[key as TestThresholdsKey];

  const level = config
    ? classifyMetric(key as TestThresholdsKey, raw)
    : 'success';

  const formatted = config
    ? `${raw.toFixed(config.precision)}${config.isPercent ? '%' : ''}${config.isAmount ? '$' : ''}`
    : String(raw);

  return {
    formatted,
    level,
  };
};
