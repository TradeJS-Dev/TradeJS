import {
  collectServerHealthSnapshot,
  evaluateServerHealth,
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
});
