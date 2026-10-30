import { escapeResearchHtml as escape } from './reportFormat';

/** Reduce only rendered points, retaining chronological bucket extrema. */
export const sampleResearchCurve = (
  points: Array<[number, number]>,
  maximum = 1200,
) => {
  if (!Number.isInteger(maximum) || maximum < 4)
    throw new Error('Curve point budget must be at least four');
  if (points.length <= maximum) return points;
  const indexes = new Set([0, points.length - 1]);
  const buckets = Math.floor((maximum - 2) / 2);
  const width = Math.ceil((points.length - 2) / buckets);
  for (let start = 1; start < points.length - 1; start += width) {
    const end = Math.min(points.length - 1, start + width);
    let low = start,
      high = start;
    for (let index = start + 1; index < end; index++) {
      if (points[index][1] < points[low][1]) low = index;
      if (points[index][1] > points[high][1]) high = index;
    }
    indexes.add(low);
    indexes.add(high);
  }
  return [...indexes].sort((a, b) => a - b).map((index) => points[index]);
};

export const researchLineChart = (
  series: Array<{
    label: string;
    points: Array<[number, number]>;
    color: string;
  }>,
  title: string,
) => {
  const populated = series.filter((item) => item.points.length);
  if (!populated.length)
    return `<p class="empty">${escape(title)}: нет наблюдений.</p>`;
  let minX = Infinity,
    maxX = -Infinity,
    minY = 0,
    maxY = 0;
  for (const item of populated)
    for (const [time, value] of item.points) {
      minX = Math.min(minX, time);
      maxX = Math.max(maxX, time);
      minY = Math.min(minY, value);
      maxY = Math.max(maxY, value);
    }
  const span = Math.max(1e-9, maxY - minY),
    x = (time: number) => 72 + (852 * (time - minX)) / Math.max(1, maxX - minX),
    y = (value: number) => 238 - (196 * (value - minY)) / span;
  const paths = populated
    .map((item) => {
      const points = sampleResearchCurve(item.points);
      const path = points
        .map(
          ([time, value], index) =>
            `${index ? 'H' : 'M'}${x(time).toFixed(2)}${index ? 'V' : ','}${y(value).toFixed(2)}`,
        )
        .join(' ');
      return `<path d="${path}" fill="none" stroke="${escape(item.color)}" stroke-width="2.5" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<figure class="chart"><figcaption>${escape(title)}</figcaption><svg viewBox="0 0 960 285" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title>${[
    4,
  ]
    .map((index) => {
      const value = minY + (span * index) / 4;
      return `<path d="M72 ${y(value)}H924" stroke="#dce5ed"/><text x="60" y="${y(value) + 4}" text-anchor="end">${value.toFixed(1)}</text>`;
    })
    .join(
      '',
    )}<path d="M72 ${y(0)}H924" stroke="#9aaebe"/>${paths}<text x="72" y="274">${new Date(minX).toISOString().slice(0, 10)}</text><text x="924" y="274" text-anchor="end">${new Date(maxX).toISOString().slice(0, 10)}</text></svg><div class="legend">${series.map((item) => `<span><i style="background:${escape(item.color)}"></i>${escape(item.label)}${item.points.length ? '' : ' · нет сделок'}</span>`).join('')}</div><p class="chart-note">Закрытые сделки · USDT. График сохраняет локальные экстремумы; точные значения хранятся в JSON.</p></figure>`;
};
