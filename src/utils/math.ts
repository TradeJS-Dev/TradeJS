import _ from 'lodash';
import { PositionLogData } from '@types';

export const diffRel = (a: number, b: number) => {
  const min = _.min([a, b]) || 0;
  const max = _.max([a, b]) || 0;

  if (!min || !max) {
    return 0;
  }

  return (1 - min / max) * 100;
};

export const round = (value: number, precision = 2) =>
  Math.round(value * 10 ** precision) / 10 ** precision;

/** Сумма чисел массива. */
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Арифметическое среднее. Для пустого массива возвращает 0. */
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

/**
 * Абсолютные ретёрны на сделку в тех же единицах, что и amount (например, $).
 * r_i^abs = close.amount - open.amount
 */
export const absReturns = (data: PositionLogData) =>
  data.map((p) => p.close.amount - p.open.amount);

/**
 * Относительные ретёрны на сделку (доли).
 * r_i^rel = (close - open) / open
 * Пример: +0.02 = +2%
 */
export const relReturns = (data: PositionLogData) =>
  data.map((p) => (p.close.amount - p.open.amount) / p.open.amount);

/**
 * Уплощённая временная линия equity: берём точки (open, close) каждой позиции
 * и сортируем по времени. Это «суррогат» equity-кривой.
 * ВАЖНО: если между позициями ничего не меняется, текущий подход «переносит»
 * последний известный amount вплоть до следующей точки.
 */
export const equityPoints = (data: PositionLogData) =>
  data
    .flatMap((p) => [
      { ts: p.open.timestamp, amount: p.open.amount },
      { ts: p.close.timestamp, amount: p.close.amount },
    ])
    .sort((a, b) => a.ts - b.ts);
