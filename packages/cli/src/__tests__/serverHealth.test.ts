import {
  buildServerHealthAttachment,
  buildServerHealthDiagnostics,
  collectServerHealthSnapshot,
  evaluateServerHealth,
  resolveServerHealthThresholds,
  type ServerHealthThresholds,
} from '../scripts/serverHealth';

describe('serverHealth', () => {
  const thresholds: ServerHealthThresholds = {
    loadPerCpuWarn: 0.9,
    loadPerCpuRecover: 0.7,
    memoryWarnPct: 92,
    memoryRecoverPct: 88,
    diskWarnPct: 95,
    diskRecoverPct: 92,
  };

  it('reports unhealthy snapshot when load, memory, and disk exceed thresholds', () => {
    const evaluation = evaluateServerHealth(
      {
        hostname: 'prod-1',
        timestamp: 1,
        cpuCount: 4,
        load1: 4,
        load5: 3.6,
        load15: 2.4,
        loadPerCpu1: 1,
        loadPerCpu5: 0.9,
        memoryUsedPct: 96,
        uptimeSec: 123,
        disk: {
          path: '/',
          usedPct: 97,
        },
      },
      thresholds,
    );

    expect(evaluation.isHealthy).toBe(false);
    expect(evaluation.issues.map((issue) => issue.code)).toEqual([
      'load',
      'memory',
      'disk',
    ]);
  });

  it('reports healthy snapshot when values are below thresholds', () => {
    const evaluation = evaluateServerHealth(
      {
        hostname: 'prod-1',
        timestamp: 1,
        cpuCount: 8,
        load1: 2,
        load5: 1.5,
        load15: 1,
        loadPerCpu1: 0.25,
        loadPerCpu5: 0.1875,
        memoryUsedPct: 71,
        uptimeSec: 123,
        disk: {
          path: '/',
          usedPct: 80,
        },
      },
      thresholds,
    );

    expect(evaluation.isHealthy).toBe(true);
    expect(evaluation.issues).toEqual([]);
  });

  it('collects a runtime snapshot with finite normalized load values', () => {
    const snapshot = collectServerHealthSnapshot('/');

    expect(snapshot.cpuCount).toBeGreaterThan(0);
    expect(Number.isFinite(snapshot.loadPerCpu1)).toBe(true);
    expect(Number.isFinite(snapshot.loadPerCpu5)).toBe(true);
    expect(snapshot.memoryUsedPct).toBeGreaterThanOrEqual(0);
  });

  it('falls back to decimal defaults when args-style flags produce zero thresholds', () => {
    expect(
      resolveServerHealthThresholds({
        loadPerCpuWarn: 0,
        loadPerCpuRecover: 0,
        memoryWarnPct: 0,
        memoryRecoverPct: 0,
        diskWarnPct: 0,
        diskRecoverPct: 0,
      }),
    ).toEqual(thresholds);
  });

  it('builds diagnostics attachment with host and process sections', () => {
    const snapshot = {
      hostname: 'prod-1',
      timestamp: Date.parse('2026-05-21T22:28:14.096Z'),
      cpuCount: 8,
      load1: 117.04,
      load5: 98.64,
      load15: 55.4,
      loadPerCpu1: 14.63,
      loadPerCpu5: 12.33,
      memoryUsedPct: 86.5,
      uptimeSec: 3 * 3600 + 54 * 60,
      disk: {
        path: '/',
        usedPct: 53.8,
      },
    };

    const content = buildServerHealthDiagnostics({
      snapshot,
      diskPath: '/',
    });
    const attachment = buildServerHealthAttachment({
      snapshot,
      diskPath: '/',
    });

    expect(content).toContain('TradeJS server health diagnostics');
    expect(content).toContain('host: prod-1');
    expect(content).toContain('=== top processes by cpu ===');
    expect(content).toContain('=== top processes by memory ===');
    expect(attachment.filename).toContain('server-health-prod-1-2026-05-21');
    expect(typeof attachment.content).toBe('string');
  });
});
