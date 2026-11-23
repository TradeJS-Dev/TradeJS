import type { Chart } from 'klinecharts';

import { marketColors, neutral } from '#app/theme/palette';

export const darkTheme = (chart: Chart) => {
  chart.setDecimalFold({
    format: (value) => String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1'),
  });
  const axis = {
    axisLine: { color: neutral[700] },
    tickLine: { color: neutral[700] },
    tickText: { color: neutral[400], size: 11 },
  };
  const crosshair = {
    line: { color: neutral[600] },
    text: {
      color: neutral[100],
      backgroundColor: marketColors.crosshairSurface,
    },
  };
  chart.setStyles({
    grid: {
      horizontal: { color: marketColors.grid },
      vertical: { color: marketColors.grid },
    },
    separator: { color: neutral[700] },
    candle: {
      bar: {
        upColor: marketColors.up,
        downColor: marketColors.down,
        noChangeColor: neutral[500],
        upBorderColor: marketColors.up,
        downBorderColor: marketColors.down,
        noChangeBorderColor: neutral[500],
        upWickColor: marketColors.up,
        downWickColor: marketColors.down,
        noChangeWickColor: neutral[500],
      },
      priceMark: {
        high: { color: neutral[300] },
        low: { color: neutral[300] },
        last: {
          upColor: marketColors.upLabel,
          downColor: marketColors.downLabel,
        },
      },
      tooltip: {
        title: { color: neutral[300] },
        legend: { color: neutral[300] },
      },
    },
    indicator: {
      bars: [
        {
          upColor: `${marketColors.up}80`,
          downColor: `${marketColors.down}80`,
          noChangeColor: `${neutral[500]}80`,
        },
      ],
    },
    xAxis: axis,
    yAxis: axis,
    crosshair: { horizontal: crosshair, vertical: crosshair },
  });
};
