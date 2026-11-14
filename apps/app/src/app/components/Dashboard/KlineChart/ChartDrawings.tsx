import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Flex, Text } from '@chakra-ui/react';
import { FiActivity, FiMinus, FiTarget, FiTrash2, FiX } from 'react-icons/fi';
import {
  registerOverlay,
  type Chart,
  type Coordinate,
  type OverlayFigure,
  type Point,
} from 'klinecharts';

type DrawingKind = 'level' | 'measure' | 'position';
type DrawingPoint = Pick<Point, 'timestamp' | 'value'>;
interface Drawing {
  id: string;
  kind: DrawingKind;
  points: DrawingPoint[];
}

const tools: Record<
  DrawingKind,
  { name: string; points: number; Icon: typeof FiMinus }
> = {
  level: { name: 'Price level', points: 1, Icon: FiMinus },
  measure: { name: 'Measure', points: 2, Icon: FiActivity },
  position: { name: 'Risk / reward', points: 3, Icon: FiTarget },
};
const groupId = 'manual-chart-drawings';
const previewId = 'manual-chart-drawing-preview';
const overlayName = (kind: DrawingKind) => `dashboard-drawing-${kind}`;

const isPoint = (value: unknown): value is DrawingPoint =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'timestamp' in value &&
      typeof value.timestamp === 'number' &&
      Number.isFinite(value.timestamp) &&
      'value' in value &&
      typeof value.value === 'number' &&
      Number.isFinite(value.value),
  );

const isDrawing = (value: unknown): value is Drawing => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('kind' in value) ||
    typeof value.kind !== 'string' ||
    !Object.hasOwn(tools, value.kind) ||
    !('points' in value) ||
    !Array.isArray(value.points)
  )
    return false;
  return (
    value.points.length === tools[value.kind as DrawingKind].points &&
    value.points.every(isPoint)
  );
};

export const loadChartDrawings = (key: string) => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isDrawing) : [];
  } catch {
    return [];
  }
};

export const measureMove = (start: number, end: number, bars: number) => {
  const change =
    start === 0 ? '—' : `${(((end - start) / start) * 100).toFixed(2)}%`;
  return `${change} · ${Math.abs(bars)} bars`;
};

export const positionRatio = (entry: number, stop: number, target: number) =>
  (target - entry) * (stop - entry) < 0
    ? `${(Math.abs(target - entry) / Math.abs(stop - entry)).toFixed(2)}R`
    : 'Stop and target must bracket entry';

let registered = false;
const registerDrawings = () => {
  if (registered) return;
  registered = true;
  for (const kind of Object.keys(tools) as DrawingKind[]) {
    registerOverlay({
      name: overlayName(kind),
      totalStep: tools[kind].points + 1,
      needDefaultPointFigure: kind !== 'level',
      needDefaultXAxisFigure: false,
      needDefaultYAxisFigure: kind === 'level',
      createPointFigures: ({ overlay, coordinates, bounding, chart }) => {
        const [first, second, third] = coordinates;
        const [start, end, target] = overlay.points;
        if (!first || start?.value === undefined) return [];
        const line = (
          coordinates: Coordinate[],
          color = '#fbbf24',
        ): OverlayFigure => ({
          type: 'line',
          attrs: { coordinates },
          styles: { color, size: 1.5 },
        });
        if (kind === 'level') {
          return [
            line([
              { x: 0, y: first.y },
              { x: bounding.width, y: first.y },
            ]),
          ];
        }
        if (!second || end?.value === undefined) return [];
        const candleIndices = chart.convertFromPixel([
          { x: first.x },
          { x: second.x },
        ]);
        const bars = Array.isArray(candleIndices)
          ? (candleIndices[1]?.dataIndex ?? 0) -
            (candleIndices[0]?.dataIndex ?? 0)
          : 0;
        const figures = [
          line([first, second], kind === 'position' ? '#fb7185' : '#fbbf24'),
        ];
        let label = measureMove(start.value, end.value, bars);
        if (kind === 'position' && overlay.extendData === 'stop')
          return figures;
        if (kind === 'position' && third && target?.value !== undefined) {
          figures.push(line([first, third], '#4ade80'));
          label = positionRatio(start.value, end.value, target.value);
        }
        figures.push({
          type: 'text',
          attrs: {
            x: Math.min(first.x, second.x),
            y: Math.min(first.y, second.y) - 8,
            text: label,
            baseline: 'bottom',
          },
          styles: {
            color: '#f8fafc',
            backgroundColor: '#1e293b',
            paddingLeft: 5,
            paddingRight: 5,
            paddingTop: 3,
            paddingBottom: 3,
          },
        });
        return figures;
      },
    });
  }
};

const nextDrawingId = (drawings: Drawing[]) =>
  `drawing-${Math.max(0, ...drawings.map(({ id }) => Number(id.split('-')[1]) || 0)) + 1}`;

export const ChartDrawings = ({
  chart,
  storageKey,
  cutoff,
  ready,
}: {
  chart: Chart;
  storageKey: string;
  cutoff?: number;
  ready: boolean;
}) => {
  const [drawings, setDrawings] = useState(() => loadChartDrawings(storageKey));
  const [pending, setPending] = useState<DrawingKind | null>(null);
  const [storageError, setStorageError] = useState(false);
  const draft = useRef<{ kind: DrawingKind; points: DrawingPoint[] } | null>(
    null,
  );
  const [pointCount, setPointCount] = useState(0);
  const [pointError, setPointError] = useState<string>();
  const current = useRef(drawings);

  useEffect(() => {
    registerDrawings();
    return () => {
      chart.removeOverlay({ groupId });
    };
  }, [chart]);

  const visible = drawings.filter(
    ({ points }) =>
      cutoff === undefined ||
      points.every(({ timestamp }) => timestamp <= cutoff),
  );

  const save = useCallback(
    (next: Drawing[]) => {
      current.current = next;
      setDrawings(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    },
    [storageKey],
  );

  useEffect(() => {
    if (!ready) return;
    for (const drawing of drawings) {
      if (
        cutoff !== undefined &&
        drawing.points.some(({ timestamp }) => timestamp > cutoff)
      )
        continue;
      chart.createOverlay({
        id: drawing.id,
        groupId,
        name: overlayName(drawing.kind),
        points: drawing.points.map((point) => ({ ...point })),
        lock: true,
      });
    }
    return () => {
      for (const { id } of drawings) chart.removeOverlay({ id });
    };
  }, [chart, drawings, cutoff, ready]);

  const cancel = useCallback(() => {
    draft.current = null;
    setPending(null);
    setPointCount(0);
    setPointError(undefined);
  }, []);

  const begin = (kind: DrawingKind) => {
    if (pending === kind) {
      cancel();
      return;
    }
    draft.current = { kind, points: [] };
    setPending(kind);
    setPointCount(0);
    setPointError(undefined);
  };

  useEffect(() => {
    if (!pending || !ready) return;
    const pane = chart.getDom('candle_pane', 'main');
    if (!pane) return;
    const previousCursor = pane.style.cursor;
    pane.style.cursor = 'crosshair';
    const readPoint = (event: MouseEvent): DrawingPoint | undefined => {
      const rect = pane.getBoundingClientRect();
      const result = chart.convertFromPixel([
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      ]);
      const point = Array.isArray(result) ? result[0] : result;
      if (isPoint(point))
        return { timestamp: point.timestamp, value: point.value };
    };
    let hasPreview = false;
    const clearPreview = () => {
      if (!hasPreview) return;
      chart.removeOverlay({ id: previewId });
      hasPreview = false;
    };
    const renderPreview = (point: DrawingPoint) => {
      const currentDraft = draft.current;
      if (!currentDraft) return;
      const points = [...currentDraft.points];
      while (points.length < tools[currentDraft.kind].points)
        points.push(point);
      const extendData =
        currentDraft.kind === 'position' && currentDraft.points.length < 2
          ? 'stop'
          : null;
      if (hasPreview) {
        chart.overrideOverlay({ id: previewId, points, extendData });
      } else {
        hasPreview = Boolean(
          chart.createOverlay({
            id: previewId,
            groupId,
            name: overlayName(currentDraft.kind),
            points,
            extendData,
            lock: true,
          }),
        );
      }
    };
    const preview = (event: MouseEvent) => {
      const point = readPoint(event);
      if (point) renderPreview(point);
      else clearPreview();
    };
    const addPoint = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const currentDraft = draft.current;
      const point = readPoint(event);
      if (!currentDraft || !point) return;
      if (currentDraft.kind === 'position') {
        const [entry, stop] = currentDraft.points;
        if (entry && !stop && point.value === entry.value) {
          setPointError('Choose a stop price different from the entry.');
          return;
        }
        if (
          entry &&
          stop &&
          (point.value - entry.value) * (stop.value - entry.value) >= 0
        ) {
          setPointError(
            'Place the target on the other side of the entry from the stop.',
          );
          return;
        }
      }
      setPointError(undefined);
      currentDraft.points.push(point);
      if (currentDraft.points.length === tools[currentDraft.kind].points) {
        const id = nextDrawingId(current.current);
        const next = [
          ...current.current,
          { id, kind: currentDraft.kind, points: currentDraft.points },
        ];
        cancel();
        save(next);
      } else {
        setPointCount(currentDraft.points.length);
        renderPreview(point);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) cancel();
    };
    pane.addEventListener('click', addPoint);
    pane.addEventListener('pointermove', preview);
    pane.addEventListener('pointerleave', clearPreview);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      pane.removeEventListener('click', addPoint);
      pane.removeEventListener('pointermove', preview);
      pane.removeEventListener('pointerleave', clearPreview);
      document.removeEventListener('keydown', onKeyDown);
      pane.style.cursor = previousCursor;
      clearPreview();
    };
  }, [cancel, chart, pending, ready, save]);

  return (
    <Flex
      as="section"
      aria-label="Chart drawings"
      direction="column"
      flexShrink={0}
      p={1}
      gap={1}
      align="center"
      position="relative"
      borderRightWidth="1px"
      borderColor="border"
    >
      {(Object.keys(tools) as DrawingKind[]).map((kind) => {
        const { name, Icon } = tools[kind];
        return (
          <Button
            key={kind}
            size="xs"
            variant={pending === kind ? 'subtle' : 'ghost'}
            colorPalette={pending === kind ? 'teal' : 'gray'}
            aria-label={name}
            title={name}
            aria-pressed={pending === kind}
            disabled={!ready}
            onClick={() => begin(kind)}
          >
            <Icon />
          </Button>
        );
      })}
      {pending && (
        <Button
          size="xs"
          variant="ghost"
          aria-label="Cancel drawing"
          title="Cancel drawing"
          onClick={cancel}
        >
          <FiX />
        </Button>
      )}
      <Button
        size="xs"
        variant="ghost"
        aria-label="Remove last drawing"
        title="Remove last drawing"
        disabled={!visible.length}
        onClick={() =>
          save(drawings.filter(({ id }) => id !== visible.at(-1)?.id))
        }
      >
        <FiTrash2 />
      </Button>
      {pending && (
        <Text
          fontSize="xs"
          role="status"
          position="absolute"
          left="calc(100% + 8px)"
          top={1}
          zIndex={1}
          pointerEvents="none"
          w="max-content"
          maxW="min(65vw, 18rem)"
          px={2}
          py={1}
          bg="gray.800"
          color="fg"
          borderRadius="sm"
        >
          {pending === 'position'
            ? pointError ??
              [
                'Select entry on the chart.',
                'Select stop on the chart.',
                'Select target on the chart.',
              ][pointCount]
            : pending === 'measure'
              ? [
                  'Select the first point on the chart.',
                  'Select the second point on the chart.',
                ][pointCount]
              : 'Select a price on the chart.'}
        </Text>
      )}
      {storageError && (
        <Text
          fontSize="xs"
          role="status"
          position="absolute"
          left="calc(100% + 8px)"
          bottom={1}
          zIndex={1}
          pointerEvents="none"
          w="max-content"
          maxW="min(65vw, 18rem)"
          px={2}
          py={1}
          bg="gray.800"
          color="fg"
          borderRadius="sm"
        >
          Could not save drawings in this browser.
        </Text>
      )}
    </Flex>
  );
};
