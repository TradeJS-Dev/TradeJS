import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Flex, Text } from '@chakra-ui/react';
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

const tools: Record<DrawingKind, { name: string; points: number }> = {
  level: { name: 'Price level', points: 1 },
  measure: { name: 'Measure', points: 2 },
  position: { name: 'Risk / reward', points: 3 },
};
const groupId = 'manual-chart-drawings';
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

  const cancel = () => {
    draft.current = null;
    setPending(null);
    setPointCount(0);
  };

  const begin = (kind: DrawingKind) => {
    draft.current = { kind, points: [] };
    setPending(kind);
    setPointCount(0);
  };

  useEffect(() => {
    if (!pending || !ready) return;
    const pane = chart.getDom('candle_pane', 'main');
    if (!pane) return;
    const addPoint = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const currentDraft = draft.current;
      if (!currentDraft) return;
      const rect = pane.getBoundingClientRect();
      const result = chart.convertFromPixel([
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
      ]);
      const point = Array.isArray(result) ? result[0] : result;
      if (!isPoint(point)) return;
      currentDraft.points.push({
        timestamp: point.timestamp,
        value: point.value,
      });
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
      }
    };
    pane.addEventListener('click', addPoint);
    return () => pane.removeEventListener('click', addPoint);
  }, [chart, pending, ready, save]);

  return (
    <Flex
      as="section"
      aria-label="Chart drawings"
      gap={2}
      wrap="wrap"
      align="center"
    >
      {(Object.keys(tools) as DrawingKind[]).map((kind) => (
        <Button
          key={kind}
          size="sm"
          variant="outline"
          aria-pressed={pending === kind}
          disabled={!ready}
          onClick={() => begin(kind)}
        >
          {tools[kind].name}
        </Button>
      ))}
      {pending && (
        <Button size="sm" variant="outline" onClick={cancel}>
          Cancel drawing
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={!visible.length}
        onClick={() =>
          save(drawings.filter(({ id }) => id !== visible.at(-1)?.id))
        }
      >
        Remove last drawing
      </Button>
      {pending && (
        <Text fontSize="sm" role="status">
          {pending === 'position'
            ? [
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
        <Text fontSize="sm" role="status">
          Could not save drawings in this browser.
        </Text>
      )}
    </Flex>
  );
};
