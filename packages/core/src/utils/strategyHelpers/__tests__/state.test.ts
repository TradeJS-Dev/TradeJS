import { createLastTradeController } from '../state';

describe('createLastTradeController', () => {
  it('keeps the legacy BACKTEST-only default when env is provided', () => {
    const backtest = createLastTradeController({ env: 'BACKTEST' });
    const parity = createLastTradeController({ env: 'PARITY' });
    const cron = createLastTradeController({ env: 'CRON' });

    backtest.markTrade(1_000);
    parity.markTrade(1_000);
    cron.markTrade(1_000);

    expect(backtest.getLastTradeTimestamp()).toBe(1_000);
    expect(backtest.isInCooldown(2_000)).toBe(true);
    expect(parity.getLastTradeTimestamp()).toBeNull();
    expect(parity.isInCooldown(2_000)).toBe(false);
    expect(cron.getLastTradeTimestamp()).toBeNull();
    expect(cron.isInCooldown(2_000)).toBe(false);
  });

  it('keeps the legacy enabled default when env is omitted', () => {
    const controller = createLastTradeController({ cooldownMs: 10 });

    controller.markTrade(1_000);

    expect(controller.getLastTradeTimestamp()).toBe(1_000);
    expect(controller.isInCooldown(1_010)).toBe(true);
    expect(controller.isInCooldown(1_011)).toBe(false);
  });

  it('honors explicit enablement and the inclusive cooldown boundary', () => {
    const controller = createLastTradeController({
      env: 'PARITY',
      enabled: true,
      cooldownMs: 10,
    });

    controller.markTrade(1_000);

    expect(controller.isInCooldown(999)).toBe(true);
    expect(controller.isInCooldown(1_010)).toBe(true);
    expect(controller.isInCooldown(1_011)).toBe(false);
  });
});
