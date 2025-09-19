import _ from 'lodash';

export const diffRel = (a: number, b: number) => {
  const min = _.min([a, b]) || 0;
  const max = _.max([a, b]) || 0;

  if (!min || !max) {
    return 0;
  }

  return (1 - min / max) * 100;
};

export const round = (value: number, precision = 2) =>
  Math.round(value * 10 ** precision) / 10 ** precision;
