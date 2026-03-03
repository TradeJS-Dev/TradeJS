import { Direction, Connector } from '@types';

export interface TrailingSideState {
  highWater?: number; // максимум с момента входа (для LONG)
  lowWater?: number; // минимум с момента входа (для SHORT)
  trail?: number; // текущий уровень трейла
  k: number; // множитель ATR (например, 2.5)
}

export interface ConnectorState {
  trailing?: TrailingSideState | null;
}

// ====== helpers (все стрелочные) ======

export const loadTrailing = async (
  connector: Connector,
): Promise<TrailingSideState | null> => {
  const raw = (await connector.getState()) as ConnectorState | undefined;
  return raw?.trailing ?? null;
};

export const saveTrailing = async (
  connector: Connector,
  trailing: TrailingSideState | null,
): Promise<void> => {
  await connector.setState({ trailing });
};

export const resetTrailingOnClose = async (
  connector: Connector,
): Promise<void> => {
  await saveTrailing(connector, null);
};

export const initTrailingOnOpen = async (
  connector: Connector,
  direction: Direction,
  entryPrice: number,
  atr: number,
  k: number,
): Promise<void> => {
  const trail =
    direction === 'LONG' ? entryPrice - atr * k : entryPrice + atr * k;

  const state: TrailingSideState =
    direction === 'LONG'
      ? { highWater: entryPrice, trail, k }
      : { lowWater: entryPrice, trail, k };

  await saveTrailing(connector, state);
};

const nextATRTrail = (
  side: TrailingSideState,
  direction: Direction,
  price: number,
  atr: number,
): TrailingSideState => {
  const k = side.k;

  if (direction === 'LONG') {
    const highWater = Math.max(side.highWater ?? price, price);
    const candidate = highWater - atr * k;
    const trail = Math.max(side.trail ?? -Infinity, candidate);
    return { ...side, highWater, trail };
  }

  const lowWater = Math.min(side.lowWater ?? price, price);
  const candidate = lowWater + atr * k;
  const trail = Math.min(side.trail ?? Infinity, candidate);
  return { ...side, lowWater, trail };
};

export const updateTrailingOnTick = async (
  connector: Connector,
  direction: Direction,
  price: number,
  atr: number,
): Promise<TrailingSideState | null> => {
  const side = await loadTrailing(connector);
  if (!side) return null; // трейлинг не инициализирован (нет позиции)
  const next = nextATRTrail(side, direction, price, atr);
  await saveTrailing(connector, next);
  return next;
};

export const checkAndCloseByTrail = async (
  connector: Connector,
  symbol: string,
  direction: Direction,
  price: number,
  timestamp: number,
): Promise<boolean> => {
  const side = await loadTrailing(connector);
  if (!side?.trail) return false;

  const hit =
    (direction === 'LONG' && price < side.trail) ||
    (direction === 'SHORT' && price > side.trail);

  if (!hit) return false;

  await connector.closePosition({ symbol, price, timestamp, direction });
  await resetTrailingOnClose(connector);
  return true;
};

// Самовосстановление после рестарта (если позиция есть, а трейлинг ещё не инициализирован)
export const ensureTrailingInitialized = async (
  connector: Connector,
  direction: Direction,
  entryPrice: number,
  atr: number,
  k: number,
): Promise<void> => {
  const side = await loadTrailing(connector);
  if (side) return;
  await initTrailingOnOpen(connector, direction, entryPrice, atr, k);
};
