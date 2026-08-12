import {
  createStrategyEvidenceMarkerEnvelope,
  strategyEvidenceFingerprint,
  strategyLogicConfigFingerprint,
  verifyStrategyEvidenceMarkerEnvelope,
} from '../strategyReleaseEvidence';

describe('strategy release evidence', () => {
  it('uses the same 16-character runtime fingerprint contract as release lineage', () => {
    expect(strategyEvidenceFingerprint({ b: 2, a: 1 })).toMatch(
      /^[a-f0-9]{16}$/,
    );
  });

  it('separates portable strategy logic from server binding and risk scale', () => {
    const local = strategyLogicConfigFingerprint({
      configId: 'DoubleTap:ai',
      strategyConfig: {
        ENABLE: true,
        ACCOUNT_ID: 'local-account',
        DEPLOYMENT_ID: 'local-deployment',
        API_KEY: 'local-key',
        API_SECRET: 'local-secret',
        OPENROUTER_API_KEY: 'local-openrouter-key',
        TG_BOT_TOKEN: 'local-telegram-token',
        MAX_LOSS_VALUE: 10,
        AI_ENABLED: true,
        AI_MODE: 'gate',
        DOUBLE_TAP_WINDOW: 40,
      },
    });
    const runtime = strategyLogicConfigFingerprint({
      configId: 'users:root:strategies:DoubleTap:config',
      strategyConfig: {
        ENABLE: true,
        ACCOUNT_ID: 'runtime-account',
        DEPLOYMENT_ID: 'runtime-deployment',
        BYBIT_API_KEY: 'runtime-key',
        BYBIT_API_SECRET: 'runtime-secret',
        OPENROUTER_API_KEY: 'runtime-openrouter-key',
        TG_BOT_TOKEN: 'runtime-telegram-token',
        MAX_LOSS_VALUE: 1,
        AI_ENABLED: true,
        AI_MODE: 'gate',
        DOUBLE_TAP_WINDOW: 40,
      },
    });

    expect(local).toBe(runtime);
    expect(
      strategyLogicConfigFingerprint({
        strategyConfig: {
          ENABLE: false,
          AI_ENABLED: true,
          AI_MODE: 'gate',
          DOUBLE_TAP_WINDOW: 40,
        },
      }),
    ).not.toBe(local);
    expect(
      strategyLogicConfigFingerprint({
        strategyConfig: {
          AI_ENABLED: true,
          AI_MODE: 'llm',
          DOUBLE_TAP_WINDOW: 40,
        },
      }),
    ).not.toBe(local);
  });

  it('shares one checksum and identity contract across publishers and readers', () => {
    const envelope = createStrategyEvidenceMarkerEnvelope({
      strategy: 'DoubleTap',
      createdAt: Date.UTC(2026, 7, 12),
      markers: [
        {
          id: 'release:G',
          type: 'G',
          timestamp: 1,
          label: 'Composition',
          summary: 'Frozen composition',
          artifactId: 'release',
          artifactSha256: 'a'.repeat(64),
          gitSha: 'deadbeef',
          gateFingerprint: 'b'.repeat(16),
          configFingerprint: 'c'.repeat(16),
          contextFingerprint: 'd'.repeat(16),
          maxLossValue: 10,
        },
      ],
      sourceArtifacts: [],
    });

    expect(verifyStrategyEvidenceMarkerEnvelope(envelope)).toEqual(envelope);
    expect(() =>
      verifyStrategyEvidenceMarkerEnvelope({
        ...envelope,
        payload: { ...envelope.payload, strategy: 'TrendLine' },
      }),
    ).toThrow('checksum');
  });
});
