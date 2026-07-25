export const YANDEX_METRIKA_COUNTER_ID = 107254154;

export type YandexMetrikaGoal = 'scaffold_success' | 'first_backtest';

type YandexMetrika = (
  counterId: number,
  method: 'reachGoal',
  target: YandexMetrikaGoal,
  params?: Record<string, unknown>,
) => void;

export const reachYandexMetrikaGoal = (
  target: YandexMetrikaGoal,
  params?: Record<string, unknown>,
) => {
  if (
    typeof window === 'undefined' ||
    process.env.NEXT_PUBLIC_TRADEJS_TELEMETRY_DISABLED === '1'
  ) {
    return false;
  }

  const ym = (window as Window & { ym?: YandexMetrika }).ym;
  if (!ym) {
    return false;
  }

  ym(YANDEX_METRIKA_COUNTER_ID, 'reachGoal', target, params);
  return true;
};
