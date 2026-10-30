import type { Candle } from '@tradejs/types';
import { sha256Text } from '../coreResearch/io';
import { DAY_MS } from '../coreResearch/metrics';

export const distributionQuantile = (
  values: number[],
  fraction: number,
): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * fraction)];
};

/** Stationary resampling of calendar days, jointly across all instruments. */
export const calendarMeanInterval = (
  rows: Array<{ timestamp: number; value: number }>,
  start: number,
  end: number,
  seed: string,
): [number, number] | null => {
  if (
    new Set(rows.map((row) => Math.floor((row.timestamp - start) / DAY_MS)))
      .size < 2 ||
    end <= start
  )
    return null;
  const days = Math.max(1, Math.ceil((end - start) / DAY_MS));
  const sums = new Float64Array(days),
    counts = new Uint32Array(days);
  for (const row of rows) {
    const index = Math.floor((row.timestamp - start) / DAY_MS);
    if (index >= 0 && index < days) {
      sums[index] += row.value;
      counts[index]++;
    }
  }
  let randomState = Number.parseInt(sha256Text(seed).slice(0, 8), 16) || 1;
  const random = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0x1_0000_0000;
  };
  const means: number[] = [];
  for (let iteration = 0; iteration < 500; iteration++) {
    let index = Math.floor(random() * days),
      sum = 0,
      count = 0;
    for (let day = 0; day < days; day++) {
      if (day && random() < 1 / 7) index = Math.floor(random() * days);
      else if (day) index = (index + 1) % days;
      sum += sums[index];
      count += counts[index];
    }
    if (count) means.push(sum / count);
  }
  if (means.length < 100) return null;
  return [
    distributionQuantile(means, 0.025)!,
    distributionQuantile(means, 0.975)!,
  ];
};

export type ResearchEventInput = {
  signalId: string;
  timestamp: number;
  symbol: string;
  direction: 'LONG' | 'SHORT';
  price: number;
  risk: number;
};
export type ResearchEventOutcome = {
  timestamp: number;
  direction: 'LONG' | 'SHORT';
  bars: number;
  moveR: number;
  maeR: number;
  mfeR: number;
  controlMoveR: number | null;
};

export const measureResearchEvents = (
  events: ResearchEventInput[],
  candles: Candle[],
  horizons: number[],
  intervalMs: number,
  end: number,
): ResearchEventOutcome[] => {
  const byTime = new Map(
    candles.map((candle, index) => [candle.timestamp, index]),
  );
  const outcomes: ResearchEventOutcome[] = [];
  for (const event of events) {
    const index = byTime.get(event.timestamp);
    if (index == null || !(event.risk > 0) || !Number.isFinite(event.risk))
      continue;
    const sign = event.direction === 'LONG' ? 1 : -1;
    for (const bars of horizons) {
      const tail = candles.slice(index + 1, index + bars + 1);
      if (
        tail.length !== bars ||
        event.timestamp + bars * intervalMs >= end ||
        tail.some(
          (candle, offset) =>
            candle.timestamp !== event.timestamp + (offset + 1) * intervalMs,
        )
      )
        continue;
      const controlIndex = index - 100;
      const control = controlIndex >= 0 ? candles[controlIndex] : undefined;
      const controlEnd =
        controlIndex >= 0 ? candles[controlIndex + bars] : undefined;
      outcomes.push({
        timestamp: event.timestamp,
        direction: event.direction,
        bars,
        moveR: (sign * (tail.at(-1)!.close - event.price)) / event.risk,
        mfeR: Math.max(
          0,
          ...tail.map(
            (candle) =>
              (sign *
                (sign === 1
                  ? candle.high - event.price
                  : candle.low - event.price)) /
              event.risk,
          ),
        ),
        maeR: Math.max(
          0,
          ...tail.map(
            (candle) =>
              (-sign *
                (sign === 1
                  ? candle.low - event.price
                  : candle.high - event.price)) /
              event.risk,
          ),
        ),
        controlMoveR:
          control && controlEnd && control.close > 0
            ? (sign * (controlEnd.close / control.close - 1)) /
              (event.risk / event.price)
            : null,
      });
    }
  }
  return outcomes;
};

export const summarizeResearchEvents = (
  outcomes: ResearchEventOutcome[],
  horizons: number[],
  start: number,
  end: number,
) =>
  horizons.flatMap((bars) =>
    (['ALL', 'LONG', 'SHORT'] as const).map((side) => {
      const selected = outcomes.filter(
        (row) =>
          row.bars === bars && (side === 'ALL' || row.direction === side),
      );
      const values = selected.map((row) => row.moveR);
      const controls = selected.filter((row) => row.controlMoveR != null);
      const mean = (numbers: number[]) =>
        numbers.length
          ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length
          : null;
      return {
        bars,
        side,
        samples: selected.length,
        events: new Set(selected.map((row) => row.timestamp)).size,
        meanMoveR: mean(values),
        meanControlMoveR: mean(controls.map((row) => row.controlMoveR!)),
        meanMfeR: mean(selected.map((row) => row.mfeR)),
        meanMaeR: mean(selected.map((row) => row.maeR)),
        p10: distributionQuantile(values, 0.1),
        median: distributionQuantile(values, 0.5),
        p90: distributionQuantile(values, 0.9),
        meanInterval95: calendarMeanInterval(
          selected.map((row) => ({
            timestamp: row.timestamp,
            value: row.moveR,
          })),
          start,
          end,
          `event-${bars}-${side}`,
        ),
        controlPairs: controls.length,
        interpretation:
          'DEV price movement in initial signal risk units; no position or fee simulation. Control is a fixed 100-bar backward shift, not a matched causal estimate.',
      };
    }),
  );
