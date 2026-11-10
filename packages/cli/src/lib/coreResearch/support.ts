import { readCoreResearchTrace } from './trace';
import type { CoreResearchSpec } from './types';

/** Fixed calendar blocks measure concentration, not statistical independence. */
export async function assessCoreResearchSupport(
  spec: CoreResearchSpec,
  criteria: NonNullable<CoreResearchSpec['support']>,
) {
  const symbols = new Set(spec.universe.symbols);
  const blockMs = spec.robustness.clusterDays * 86_400_000;
  const variants = [];
  for (const variant of spec.variants) {
    if (!variant.traceFiles?.length) continue;
    const setups = new Set<string>();
    const timestamps = new Set<number>();
    const blocks = new Map<number, Set<number>>();
    const seenSymbols = new Set<string>();
    const runs = new Set<string | undefined>();
    let fallbackRows = 0;
    for await (const event of readCoreResearchTrace(variant.traceFiles)) {
      if (variant.runId && event.backtestRunId !== variant.runId) continue;
      runs.add(event.backtestRunId);
      if (
        (event.event !== 'signal_emitted' &&
          event.event !== 'entry_rejected') ||
        event.strategy !== spec.strategy ||
        !symbols.has(event.symbol) ||
        (spec.hypothesis.target !== 'ALL' &&
          event.direction !== spec.hypothesis.target) ||
        !Number.isSafeInteger(event.timestamp) ||
        event.timestamp < spec.window.start ||
        event.timestamp >= spec.window.end
      )
        continue;
      timestamps.add(event.timestamp);
      seenSymbols.add(event.symbol);
      if (
        event.setupIdentitySource === 'strategy-context' &&
        event.setupIdentity
      ) {
        setups.add(
          JSON.stringify([event.symbol, event.direction, event.setupIdentity]),
        );
      } else fallbackRows++;
      const block = Math.floor((event.timestamp - spec.window.start) / blockMs);
      const times = blocks.get(block) ?? new Set<number>();
      times.add(event.timestamp);
      blocks.set(block, times);
    }
    if (runs.size > 1)
      throw new Error(`Support traces mix runs for ${variant.id}`);
    variants.push({
      id: variant.id,
      role: variant.role,
      setups,
      events: timestamps.size,
      symbols: seenSymbols.size,
      fallbackRows,
      blocks: [...blocks]
        .sort(([a], [b]) => a - b)
        .map(([index, times]) => ({
          start: spec.window.start + index * blockMs,
          events: times.size,
        })),
      passed:
        timestamps.size >= criteria.minimumEvents &&
        blocks.size >= criteria.minimumBlocks,
    });
  }
  const control = variants.find((v) => v.role === 'control');
  const candidates = variants.filter((v) => v.role === 'candidate');
  const comparisons = control
    ? candidates.map((candidate) => ({
        candidate: candidate.id,
        commonSetups: [...candidate.setups].filter((id) =>
          control.setups.has(id),
        ).length,
      }))
    : [];
  const missing =
    !control ||
    (criteria.minimumCommonSetups !== undefined &&
      candidates.length !==
        spec.variants.filter((v) => v.role === 'candidate').length);
  const insufficient =
    variants.some((v) => !v.passed) ||
    comparisons.some(
      (c) => c.commonSetups < (criteria.minimumCommonSetups ?? 0),
    );
  return {
    schema: 'tradejs-core-research-support/v1',
    window: { start: spec.window.start, end: spec.window.end },
    target: spec.hypothesis.target,
    blockDays: spec.robustness.clusterDays,
    criteria,
    status: missing
      ? 'missing-evidence'
      : insufficient
        ? 'insufficient-support'
        : 'supported',
    variants: variants.map(({ setups, ...variant }) => ({
      ...variant,
      explicitSetups: setups.size,
    })),
    comparisons,
  };
}
