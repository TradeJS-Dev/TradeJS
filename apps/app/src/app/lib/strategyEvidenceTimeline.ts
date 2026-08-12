import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  canonicalStrategyEvidenceJson,
  safeStrategyEvidenceSegment,
  verifyStrategyEvidenceMarkerEnvelope,
} from '@tradejs/infra/strategyReleaseEvidence';
import {
  type StrategyEvidenceMarker,
  type StrategyEvidenceMarkerEnvelope,
  type StrategyEvidenceTimeline,
  type StrategyEvidenceTimelineSelector,
} from '@tradejs/types';

const DEFAULT_MARKER_DIRECTORY = 'data/strategy-release/markers';
type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export { canonicalStrategyEvidenceJson, verifyStrategyEvidenceMarkerEnvelope };

export const strategyEvidenceTimelineSelectorKey = (
  selector: StrategyEvidenceTimelineSelector,
) =>
  [
    selector.strategy,
    selector.compositionId ?? '',
    selector.gitSha ?? '',
    selector.gateFingerprint ?? '',
    selector.configFingerprint ?? '',
    selector.contextFingerprint ?? '',
    selector.maxLossValue ?? '',
    selector.requireCompleteLineage ? 'exact' : 'partial',
  ].join(':');

const discoverJsonFiles = async (rootDir: string): Promise<string[]> => {
  const files: string[] = [];

  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 12) return;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.name.startsWith('.') || entry.name.includes('.tmp-')) return;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          files.push(entryPath);
        }
      }),
    );
  };

  await visit(rootDir, 0);
  return files.sort();
};

const inferMatchingStrategies = ({
  filePath,
  parsed,
  strategies,
}: {
  filePath: string;
  parsed: unknown;
  strategies: string[];
}) => {
  const root = asRecord(parsed);
  const payload = asRecord(root?.payload);
  const declaredStrategy = isNonEmptyString(payload?.strategy)
    ? payload.strategy
    : null;
  const artifactId = isNonEmptyString(root?.artifactId)
    ? root.artifactId
    : path.basename(filePath, '.json');
  const parentSegment = path.basename(path.dirname(filePath));

  return strategies.filter(
    (strategy) =>
      strategy === declaredStrategy ||
      artifactId.startsWith(`${safeStrategyEvidenceSegment(strategy)}_`) ||
      parentSegment === safeStrategyEvidenceSegment(strategy),
  );
};

const missingTimeline = (): StrategyEvidenceTimeline => ({
  status: 'missing',
  observedFrom: null,
  markers: [],
});

const invalidTimeline = (): StrategyEvidenceTimeline => ({
  status: 'invalid',
  observedFrom: null,
  markers: [],
});

export const loadStrategyEvidenceTimelines = async ({
  projectRoot,
  markerDir,
  selectors: requestedSelectors,
  startTime,
  endTime,
}: {
  projectRoot: string;
  markerDir?: string | null;
  selectors: Iterable<StrategyEvidenceTimelineSelector>;
  startTime: number;
  endTime: number;
}): Promise<Map<string, StrategyEvidenceTimeline>> => {
  const selectors = [...requestedSelectors]
    .filter((selector) => selector.strategy.trim().length > 0)
    .sort((left, right) =>
      strategyEvidenceTimelineSelectorKey(left).localeCompare(
        strategyEvidenceTimelineSelectorKey(right),
      ),
    );
  const strategies = [...new Set(selectors.map(({ strategy }) => strategy))];
  const timelines = new Map(
    selectors.map((selector) => [
      strategyEvidenceTimelineSelectorKey(selector),
      missingTimeline(),
    ]),
  );
  if (!selectors.length) return timelines;

  const configuredDir = markerDir?.trim() || DEFAULT_MARKER_DIRECTORY;
  const rootDir = path.isAbsolute(configuredDir)
    ? configuredDir
    : path.resolve(projectRoot, configuredDir);
  let files: string[];
  try {
    files = [
      ...new Set(
        (
          await Promise.all(
            strategies.map((strategy) =>
              discoverJsonFiles(
                path.join(rootDir, safeStrategyEvidenceSegment(strategy)),
              ),
            ),
          )
        ).flat(),
      ),
    ].sort();
  } catch {
    for (const selector of selectors) {
      timelines.set(
        strategyEvidenceTimelineSelectorKey(selector),
        invalidTimeline(),
      );
    }
    return timelines;
  }

  const envelopesByStrategy = new Map<
    string,
    StrategyEvidenceMarkerEnvelope[]
  >();
  const invalidStrategies = new Set<string>();

  for (const filePath of files) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown;
    } catch {
      for (const strategy of inferMatchingStrategies({
        filePath,
        parsed,
        strategies,
      })) {
        invalidStrategies.add(strategy);
      }
      continue;
    }

    const matchingStrategies = inferMatchingStrategies({
      filePath,
      parsed,
      strategies,
    });
    if (!matchingStrategies.length) continue;

    try {
      const envelope = verifyStrategyEvidenceMarkerEnvelope(parsed);
      for (const strategy of matchingStrategies) {
        if (strategy !== envelope.payload.strategy) {
          invalidStrategies.add(strategy);
        }
      }
      if (!strategies.includes(envelope.payload.strategy)) {
        continue;
      }
      const envelopes =
        envelopesByStrategy.get(envelope.payload.strategy) ?? [];
      envelopes.push(envelope);
      envelopesByStrategy.set(envelope.payload.strategy, envelopes);
    } catch {
      for (const strategy of matchingStrategies) {
        invalidStrategies.add(strategy);
      }
    }
  }

  for (const selector of selectors) {
    const strategy = selector.strategy;
    const selectorKey = strategyEvidenceTimelineSelectorKey(selector);
    if (invalidStrategies.has(strategy)) {
      timelines.set(selectorKey, invalidTimeline());
      continue;
    }

    const envelopes = envelopesByStrategy.get(strategy) ?? [];
    if (!envelopes.length) continue;
    const hasCompleteSelector =
      Boolean(selector.compositionId) ||
      (Boolean(selector.gitSha) &&
        Boolean(selector.gateFingerprint) &&
        Boolean(selector.configFingerprint) &&
        Boolean(selector.contextFingerprint) &&
        selector.maxLossValue != null);
    if (selector.requireCompleteLineage && !hasCompleteSelector) continue;

    const markersById = new Map<string, StrategyEvidenceMarker>();
    let hasConflict = false;
    for (const envelope of envelopes) {
      for (const marker of envelope.payload.markers) {
        const existing = markersById.get(marker.id);
        if (
          existing &&
          canonicalStrategyEvidenceJson(existing) !==
            canonicalStrategyEvidenceJson(marker)
        ) {
          hasConflict = true;
          break;
        }
        markersById.set(marker.id, marker);
      }
      if (hasConflict) break;
    }

    if (hasConflict) {
      timelines.set(selectorKey, invalidTimeline());
      continue;
    }

    const markers = [...markersById.values()]
      .filter(
        (marker) =>
          (!selector.compositionId ||
            marker.compositionId === selector.compositionId) &&
          (!selector.gitSha || marker.gitSha === selector.gitSha) &&
          (!selector.gateFingerprint ||
            marker.gateFingerprint === selector.gateFingerprint) &&
          (!selector.configFingerprint ||
            marker.configFingerprint === selector.configFingerprint) &&
          (!selector.contextFingerprint ||
            marker.contextFingerprint === selector.contextFingerprint) &&
          (selector.maxLossValue == null ||
            marker.maxLossValue === selector.maxLossValue) &&
          marker.timestamp >= startTime &&
          marker.timestamp < endTime,
      )
      .sort(
        (left, right) =>
          left.timestamp - right.timestamp ||
          left.type.localeCompare(right.type) ||
          left.id.localeCompare(right.id),
      );
    if (
      !markers.length &&
      (selector.compositionId ||
        selector.gitSha ||
        selector.gateFingerprint ||
        selector.configFingerprint ||
        selector.contextFingerprint ||
        selector.maxLossValue != null)
    ) {
      continue;
    }
    timelines.set(selectorKey, {
      status: 'verified',
      observedFrom: markers.length
        ? Math.min(...markers.map((marker) => marker.timestamp))
        : Math.min(...envelopes.map((envelope) => envelope.payload.createdAt)),
      markers,
    });
  }

  return timelines;
};
