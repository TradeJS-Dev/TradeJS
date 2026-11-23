import { useEffect } from 'react';
import type { Chart } from 'klinecharts';
import { marketColors } from '#app/theme/palette';

const candlePane = 'candle_pane';

export const useLatestCandleGuide = (
  chart: Chart | null,
  timestamp: number | undefined,
) => {
  useEffect(() => {
    if (!chart || timestamp === undefined) return;
    const pane = chart.getDom(candlePane, 'main');
    if (!pane) return;

    const guide = document.createElement('div');
    guide.setAttribute('aria-hidden', 'true');
    guide.dataset.latestCandleGuide = String(timestamp);
    Object.assign(guide.style, {
      position: 'absolute',
      insetBlock: '0',
      left: '0',
      width: 'min(112px, 33.33%)',
      background: `linear-gradient(90deg, transparent, ${marketColors.up}22)`,
      pointerEvents: 'none',
      visibility: 'hidden',
    });

    const line = document.createElement('div');
    Object.assign(line.style, {
      position: 'absolute',
      insetBlock: '0',
      right: '0',
      width: '1px',
      background: `repeating-linear-gradient(${marketColors.up}99 0 3px, transparent 3px 7px)`,
    });
    guide.append(line);
    pane.append(guide);

    let frame = 0;
    const redraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const point = chart.convertToPixel(
          { timestamp },
          { paneId: candlePane },
        );
        const x = Array.isArray(point) ? undefined : point.x;
        const visible =
          x !== undefined &&
          Number.isFinite(x) &&
          x >= 0 &&
          x <= pane.clientWidth;
        guide.style.visibility = visible ? 'visible' : 'hidden';
        if (visible) {
          guide.style.transform = `translateX(calc(${x}px - 100%))`;
          guide.style.clipPath = `inset(0 0 0 max(0px, calc(100% - ${x}px)))`;
        }
      });
    };
    redraw();
    chart.subscribeAction('onVisibleRangeChange', redraw);
    const resize = new ResizeObserver(redraw);
    resize.observe(pane);
    return () => {
      resize.disconnect();
      chart.unsubscribeAction('onVisibleRangeChange', redraw);
      cancelAnimationFrame(frame);
      guide.remove();
    };
  }, [chart, timestamp]);
};
