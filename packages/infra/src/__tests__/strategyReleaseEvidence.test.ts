import {
  createStrategyEvidenceMarkerEnvelope,
  strategyEvidenceFingerprint,
  verifyStrategyEvidenceMarkerEnvelope,
} from '../strategyReleaseEvidence';

describe('strategy release evidence', () => {
  it('uses the same 16-character runtime fingerprint contract as release lineage', () => {
    expect(strategyEvidenceFingerprint({ b: 2, a: 1 })).toMatch(
      /^[a-f0-9]{16}$/,
    );
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
