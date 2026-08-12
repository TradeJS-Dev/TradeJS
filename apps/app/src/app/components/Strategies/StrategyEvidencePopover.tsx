'use client';

import {
  Badge,
  Box,
  Button,
  Checkbox,
  Flex,
  Popover,
  Portal,
  Text,
} from '@chakra-ui/react';
import type {
  StrategyEvidenceMarker,
  StrategyEvidenceMarkerType,
  StrategyEvidenceTimeline,
} from '@tradejs/types';
import { formatTimeSeriesTooltipTimestamp } from '#app/lib/timeSeriesChart';

export const STRATEGY_EVIDENCE_MARKER_PRESENTATION: Record<
  StrategyEvidenceMarkerType,
  { name: string; color: string; optional: boolean }
> = {
  G: { name: 'Composition / gate', color: 'purple.400', optional: false },
  L: { name: 'MAX_LOSS_VALUE', color: 'orange.400', optional: false },
  E: { name: 'Evidence boundary', color: 'teal.400', optional: false },
  D: { name: 'Deployment', color: 'blue.400', optional: false },
  P: { name: 'Runtime parity', color: 'cyan.400', optional: true },
  R: { name: 'Recommendation', color: 'pink.400', optional: true },
};

const MARKER_TYPES = Object.keys(
  STRATEGY_EVIDENCE_MARKER_PRESENTATION,
) as StrategyEvidenceMarkerType[];

export const filterStrategyEvidenceMarkers = ({
  markers,
  showParity,
  showRecommendations,
}: {
  markers: StrategyEvidenceMarker[];
  showParity: boolean;
  showRecommendations: boolean;
}) =>
  markers.filter(
    (marker) =>
      (marker.type !== 'P' || showParity) &&
      (marker.type !== 'R' || showRecommendations),
  );

const statusColor = (status: StrategyEvidenceTimeline['status']) => {
  if (status === 'verified') return 'teal';
  if (status === 'invalid') return 'red';
  return 'orange';
};

const uniqueProvenance = (markers: StrategyEvidenceMarker[]) => {
  const seen = new Set<string>();
  return markers.filter((marker) => {
    const key = `${marker.artifactId}:${marker.artifactSha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const FilterCheckbox = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) => (
  <Checkbox.Root
    size="sm"
    checked={checked}
    onCheckedChange={({ checked: nextChecked }) =>
      onChange(nextChecked === true)
    }
  >
    <Checkbox.HiddenInput />
    <Checkbox.Control>
      <Checkbox.Indicator />
    </Checkbox.Control>
    <Checkbox.Label>{label}</Checkbox.Label>
  </Checkbox.Root>
);

export const StrategyEvidencePopover = ({
  timeline,
  showParity,
  showRecommendations,
  onShowParityChange,
  onShowRecommendationsChange,
}: {
  timeline: StrategyEvidenceTimeline;
  showParity: boolean;
  showRecommendations: boolean;
  onShowParityChange: (checked: boolean) => void;
  onShowRecommendationsChange: (checked: boolean) => void;
}) => {
  const provenance =
    timeline.status === 'verified' ? uniqueProvenance(timeline.markers) : [];

  return (
    <Popover.Root positioning={{ placement: 'bottom-end' }} lazyMount>
      <Popover.Trigger asChild>
        <Button
          size="xs"
          variant="outline"
          aria-label={`Evidence: ${timeline.status}`}
        >
          Evidence
          <Badge size="xs" colorPalette={statusColor(timeline.status)}>
            {timeline.status === 'verified'
              ? `${timeline.markers.length}`
              : timeline.status}
          </Badge>
        </Button>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content width="min(430px, calc(100vw - 24px))">
            <Popover.Arrow />
            <Popover.Body>
              <Flex direction="column" gap={3}>
                <Box>
                  <Text fontWeight="semibold">Immutable evidence</Text>
                  <Text fontSize="xs" color="gray.500">
                    {timeline.status === 'verified'
                      ? timeline.observedFrom == null
                        ? 'Verified artifact; no observation boundary supplied.'
                        : `Verified from ${formatTimeSeriesTooltipTimestamp(
                            timeline.observedFrom,
                          )}.`
                      : timeline.status === 'invalid'
                        ? 'Evidence failed checksum, identity, or structure verification. No markers are rendered.'
                        : 'No checksum-verified evidence artifact is available. No mutable fallback is used.'}
                  </Text>
                </Box>

                <Box>
                  <Text fontSize="xs" fontWeight="semibold" mb={1}>
                    Legend
                  </Text>
                  <Flex wrap="wrap" gapX={3} gapY={1}>
                    {MARKER_TYPES.map((type) => (
                      <Flex key={type} align="center" gap={1}>
                        <Text
                          color={
                            STRATEGY_EVIDENCE_MARKER_PRESENTATION[type].color
                          }
                          fontWeight="bold"
                          fontSize="xs"
                        >
                          {type}
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                          {STRATEGY_EVIDENCE_MARKER_PRESENTATION[type].name}
                        </Text>
                      </Flex>
                    ))}
                  </Flex>
                </Box>

                <Box>
                  <Text fontSize="xs" fontWeight="semibold" mb={1}>
                    Optional markers
                  </Text>
                  <Flex gap={4}>
                    <FilterCheckbox
                      checked={showParity}
                      label="Parity (P)"
                      onChange={onShowParityChange}
                    />
                    <FilterCheckbox
                      checked={showRecommendations}
                      label="Recommendations (R)"
                      onChange={onShowRecommendationsChange}
                    />
                  </Flex>
                </Box>

                <Box>
                  <Text fontSize="xs" fontWeight="semibold" mb={1}>
                    Events and provenance
                  </Text>
                  {timeline.status === 'verified' && timeline.markers.length ? (
                    <Flex
                      direction="column"
                      gap={2}
                      maxH="220px"
                      overflowY="auto"
                    >
                      {timeline.markers.map((marker) => (
                        <Box key={marker.id}>
                          <Flex align="baseline" gap={2}>
                            <Text
                              color={
                                STRATEGY_EVIDENCE_MARKER_PRESENTATION[
                                  marker.type
                                ].color
                              }
                              fontWeight="bold"
                              fontSize="xs"
                            >
                              {marker.type}
                            </Text>
                            <Text fontSize="xs" fontWeight="semibold">
                              {marker.label}
                            </Text>
                            <Text fontSize="xs" color="gray.500">
                              {formatTimeSeriesTooltipTimestamp(
                                marker.timestamp,
                              )}
                            </Text>
                          </Flex>
                          <Text fontSize="xs" color="gray.500">
                            {marker.summary}
                          </Text>
                        </Box>
                      ))}
                    </Flex>
                  ) : (
                    <Text fontSize="xs" color="gray.500">
                      No verified events in the selected window.
                    </Text>
                  )}
                </Box>

                {provenance.length ? (
                  <Box>
                    <Text fontSize="xs" fontWeight="semibold" mb={1}>
                      Artifact provenance
                    </Text>
                    {provenance.map((marker) => (
                      <Text
                        key={`${marker.artifactId}:${marker.artifactSha256}`}
                        fontSize="xs"
                        color="gray.500"
                        fontFamily="mono"
                        title={marker.artifactSha256}
                      >
                        {marker.artifactId} ·{' '}
                        {marker.artifactSha256.slice(0, 12)}
                      </Text>
                    ))}
                  </Box>
                ) : null}
              </Flex>
            </Popover.Body>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
};
