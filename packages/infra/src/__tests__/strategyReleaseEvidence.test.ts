import {
  createStrategyEvidenceMarkerEnvelope,
  verifyStrategyEvidenceMarkerEnvelope,
} from '../strategyReleaseEvidence';

describe('strategy release evidence', () => {
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
          gateFingerprint: 'b'.repeat(64),
          configFingerprint: 'c'.repeat(64),
          contextFingerprint: 'd'.repeat(64),
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
