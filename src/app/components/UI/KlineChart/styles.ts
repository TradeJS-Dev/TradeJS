import { Chart } from 'klinecharts';

export const darkTheme = (chart: Chart) => {
  chart.setStyles({
    grid: {
      horizontal: {
        color: '#374151', // цвет горизонтальных линий сетки
      },
      vertical: {
        color: '#374151', // цвет вертикальных линий сетки
      },
    },
    candle: {
      // type: 'candle_solid',
      bar: {
        upColor: '#26a69a', // цвет свечи вверх
        downColor: '#ef5350', // цвет свечи вниз
        noChangeColor: '#888888', // цвет свечи без изменения
        upBorderColor: '#26a69a',
        downBorderColor: '#ef5350',
        noChangeBorderColor: '#888888',
        upWickColor: '#26a69a',
        downWickColor: '#ef5350',
        noChangeWickColor: '#888888',
      },
    },
    xAxis: {
      axisLine: {
        color: '#4b5563', // цвет оси X
      },
      tickLine: {
        color: '#4b5563',
      },
      tickText: {
        color: '#9ca3af', // цвет текста подписей по оси X
      },
    },
    yAxis: {
      axisLine: {
        color: '#4b5563', // цвет оси Y
      },
      tickLine: {
        color: '#4b5563',
      },
      tickText: {
        color: '#9ca3af', // цвет текста подписей по оси Y
      },
    },
    crosshair: {
      horizontal: {
        line: {
          color: '#6b7280', // цвет горизонтальной линии перекрестия
        },
        text: {
          color: '#f3f4f6', // цвет текста горизонтальной линии перекрестия
          backgroundColor: '#1f2937', // фон текста горизонтальной линии перекрестия
        },
      },
      vertical: {
        line: {
          color: '#6b7280', // цвет вертикальной линии перекрестия
        },
        text: {
          color: '#f3f4f6', // цвет текста вертикальной линии перекрестия
          backgroundColor: '#1f2937', // фон текста вертикальной линии перекрестия
        },
      },
    },
  });
};
