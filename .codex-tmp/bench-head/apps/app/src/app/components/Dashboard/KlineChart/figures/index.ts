import { registerFigure } from 'klinecharts';
import { diamond } from './diamond';
import { rectangle } from './rectangle';
import { circle } from './circle';
import { star } from './star';
import { square } from './square';
import { triangle } from './triangle';
import { label } from './label';

// label
registerFigure({
  name: 'btLabel',
  draw: (
    ctx: CanvasRenderingContext2D,
    attrs: {
      x: number;
      y: number;
      text: string;
      width: number;
      height: number;
      color: string;
    },
  ) => {
    label({
      ctx,
      x: attrs.x,
      y: attrs.y,
      text: attrs.text,
      width: attrs.width,
      height: attrs.height,
      color: attrs.color,
    });
  },
  checkEventOn: (coordinate, attrs) => {
    const { x, y } = coordinate;
    const { width, height } = attrs;
    return Math.abs(x * height) + Math.abs(y * width) <= (width * height) / 2;
  },
});

// прямоугольник
registerFigure({
  name: 'btRect',
  draw: (
    ctx: CanvasRenderingContext2D,
    attrs: {
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
    },
  ) => {
    rectangle({
      ctx,
      x: attrs.x,
      y: attrs.y,
      width: attrs.width,
      height: attrs.height,
      color: attrs.color,
    });
  },
  checkEventOn: (coordinate, attrs) => {
    const { x, y } = coordinate;
    const { width, height } = attrs;
    return Math.abs(x * height) + Math.abs(y * width) <= (width * height) / 2;
  },
});

// ромб
registerFigure({
  name: 'btDiamond',
  draw: (
    ctx: CanvasRenderingContext2D,
    attrs: {
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
    },
  ) => {
    diamond({
      ctx,
      x: attrs.x,
      y: attrs.y,
      width: attrs.width,
      height: attrs.height,
      color: attrs.color,
    });
  },
  checkEventOn: (coordinate, attrs) => {
    const { x, y } = coordinate;
    const { width, height } = attrs;
    return Math.abs(x * height) + Math.abs(y * width) <= (width * height) / 2;
  },
});

// звезда / крестик
registerFigure({
  name: 'btStar',
  draw: (
    ctx: CanvasRenderingContext2D,
    attrs: {
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
    },
  ) => {
    star({
      ctx,
      x: attrs.x,
      y: attrs.y,
      width: attrs.width,
      height: attrs.height,
      color: attrs.color,
    });
  },
  checkEventOn: (coordinate, attrs) => {
    const { x, y } = coordinate;
    const { width, height } = attrs;
    return Math.abs(x * height) + Math.abs(y * width) <= (width * height) / 2;
  },
});

// кружок
registerFigure({
  name: 'btCircle',
  draw: (
    ctx: CanvasRenderingContext2D,
    attrs: {
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
    },
  ) => {
    circle({
      ctx,
      x: attrs.x,
      y: attrs.y,
      width: attrs.width,
      height: attrs.height,
      color: attrs.color,
    });
  },
  checkEventOn: (coordinate, attrs) => {
    const { x, y } = coordinate;
    const { width, height } = attrs;
    return Math.abs(x * height) + Math.abs(y * width) <= (width * height) / 2;
  },
});

// квадрат
registerFigure({
  name: 'btSquare',
  draw: (
    ctx: CanvasRenderingContext2D,
    attrs: {
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
    },
  ) => {
    square({
      ctx,
      x: attrs.x,
      y: attrs.y,
      width: attrs.width,
      height: attrs.height,
      color: attrs.color,
    });
  },
  checkEventOn: (coordinate, attrs) => {
    const { x, y } = coordinate;
    const { width, height } = attrs;
    return Math.abs(x * height) + Math.abs(y * width) <= (width * height) / 2;
  },
});

// треугольник
registerFigure({
  name: 'btTriangle',
  draw: (
    ctx: CanvasRenderingContext2D,
    attrs: {
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
    },
  ) => {
    triangle({
      ctx,
      x: attrs.x,
      y: attrs.y,
      width: attrs.width,
      height: attrs.height,
      color: attrs.color,
    });
  },
  checkEventOn: (coordinate, attrs) => {
    const { x, y } = coordinate;
    const { width, height } = attrs;
    return Math.abs(x * height) + Math.abs(y * width) <= (width * height) / 2;
  },
});
