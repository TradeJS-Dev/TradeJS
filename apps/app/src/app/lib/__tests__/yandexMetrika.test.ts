import {
  reachYandexMetrikaGoal,
  YANDEX_METRIKA_COUNTER_ID,
} from '../yandexMetrika';

describe('Yandex Metrika goals', () => {
  const originalTelemetryDisabled =
    process.env.NEXT_PUBLIC_TRADEJS_TELEMETRY_DISABLED;

  afterEach(() => {
    if (originalTelemetryDisabled === undefined) {
      delete process.env.NEXT_PUBLIC_TRADEJS_TELEMETRY_DISABLED;
    } else {
      process.env.NEXT_PUBLIC_TRADEJS_TELEMETRY_DISABLED =
        originalTelemetryDisabled;
    }
    delete (window as Window & { ym?: jest.Mock }).ym;
  });

  it('reports a supported goal to the TradeJS counter', () => {
    const ym = jest.fn();
    (window as Window & { ym?: jest.Mock }).ym = ym;

    expect(reachYandexMetrikaGoal('scaffold_success')).toBe(true);
    expect(ym).toHaveBeenCalledWith(
      YANDEX_METRIKA_COUNTER_ID,
      'reachGoal',
      'scaffold_success',
      undefined,
    );
  });

  it('does not report goals when telemetry is disabled', () => {
    process.env.NEXT_PUBLIC_TRADEJS_TELEMETRY_DISABLED = '1';
    const ym = jest.fn();
    (window as Window & { ym?: jest.Mock }).ym = ym;

    expect(reachYandexMetrikaGoal('first_backtest')).toBe(false);
    expect(ym).not.toHaveBeenCalled();
  });
});
