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
    selector.releaseVersion ?? '',
    selector.compositionId ?? '',
    selector.gitSha ?? '',
    selector.gateFingerprint ?? '',
    selector.configFingerprint ?? '',
    selector.contextFingerprint ?? '',
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
  rootDir,
  parsed,
  strategies,
}: {
  filePath: string;
  rootDir: string;
  parsed: unknown;
  strategies: string[];
}) => {
  const payload = asRecord(asRecord(parsed)?.payload);
  const declaredStrategy = isNonEmptyString(payload?.strategy)
    ? payload.strategy
    : null;
  const directoryStrategy = path.relative(rootDir, filePath).split(path.sep)[0];
  return strategies.filter(
    (strategy) =>
      strategy === declaredStrategy ||
      directoryStrategy === safeStrategyEvidenceSegment(strategy),
  );
};

const missingTimeline = (): StrategyEvidenceTimeline => ({
  status: 'missing',
  observedFrom: null,
  markers: [],
});

const notAttachedTimeline = (): StrategyEvidenceTimeline => ({
  status: 'not_attached',
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
      selector.releaseVersion ? notAttachedTimeline() : missingTimeline(),
    ]),
  );
  if (!selectors.length) return timelines;

  const configuredDir = markerDir?.trim() || DEFAULT_MARKER_DIRECTORY;
  const rootDir = path.isAbsolute(configuredDir)
    ? configuredDir
    : path.resolve(projectRoot, configuredDir);
  let files: string[];
  try {
    files = await discoverJsonFiles(rootDir);
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
        rootDir,
        parsed,
        strategies,
      })) {
        invalidStrategies.add(strategy);
      }
      continue;
    }

    const matchingStrategies = inferMatchingStrategies({
      filePath,
      rootDir,
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
      selector.releaseVersion != null ||
      (Boolean(selector.compositionId) &&
        Boolean(selector.gitSha) &&
        Boolean(selector.gateFingerprint) &&
        Boolean(selector.configFingerprint) &&
        Boolean(selector.contextFingerprint));
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

    const matchingMarkers = [...markersById.values()]
      .filter(
        (marker) =>
          (!selector.compositionId ||
            marker.compositionId === selector.compositionId) &&
          (!selector.releaseVersion ||
            marker.releaseVersion === selector.releaseVersion) &&
          (!selector.gitSha || marker.gitSha === selector.gitSha) &&
          (!selector.gateFingerprint ||
            marker.gateFingerprint === selector.gateFingerprint) &&
          (!selector.configFingerprint ||
            marker.configFingerprint === selector.configFingerprint) &&
          (!selector.contextFingerprint ||
            marker.contextFingerprint === selector.contextFingerprint) &&
          marker.timestamp >= startTime &&
          marker.timestamp < endTime,
      )
      .sort(
        (left, right) =>
          left.timestamp - right.timestamp ||
          left.type.localeCompare(right.type) ||
          left.id.localeCompare(right.id),
      );
    let lastLossValue: number | null | undefined;
    let hasLastLossValue = false;
    const markers = matchingMarkers.filter((marker) => {
      if (marker.type !== 'L') return true;
      if (hasLastLossValue && marker.maxLossValue === lastLossValue) {
        return false;
      }
      hasLastLossValue = true;
      lastLossValue = marker.maxLossValue;
      return true;
    });
    if (
      !markers.length &&
      (selector.compositionId ||
        selector.releaseVersion ||
        selector.gitSha ||
        selector.gateFingerprint ||
        selector.configFingerprint ||
        selector.contextFingerprint)
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
