import type { ResearchConclusion } from './types';
import { escapeResearchHtml as escape } from './reportFormat';
import { researchLineChart } from './charts';

const number = (value: number | null | undefined) =>
  value == null ? 'н/д' : value.toFixed(3);
export const buildJevComparisonReport = (conclusion?: ResearchConclusion) => {
  const result = conclusion?.jevComparison;
  if (!result) return '';
  const labels = {
    'not-configured': 'Jev не настроен',
    inconclusive: 'Польза Jev не подтверждена',
    improved: 'С Jev PnL выше',
    worse: 'С Jev PnL ниже',
  };
  const pair = result.pair;
  const charts = pair
    ? [
        {
          label: 'С Jev',
          points:
            conclusion!.evaluations.find((item) => item.id === pair.withJev.id)
              ?.testEquity ?? [],
          color: '#265d97',
        },
        {
          label: 'Без Jev',
          points:
            conclusion!.evaluations.find(
              (item) => item.id === pair.withoutJev.id,
            )?.testEquity ?? [],
          color: '#b2464d',
        },
      ]
    : [];
  return `<section id="jev"><h2>Что добавляет Jev</h2><div class="panel"><h3>${labels[result.status]}</h3><p>${escape(result.reason)}</p>${result.evidence === 'retrospective' ? '<p class="evidence-note">Ретроспективная история: это наблюдаемый эффект на указанном периоде, а не независимое подтверждение.</p>' : ''}${
    pair
      ? `<p>Ядро: ${escape(pair.coreId)}. Общие направления: ${escape(pair.withJev.policy.directions?.join(' + '))}. До TEST выбран режим: <strong>${pair.preferredOnDev === 'enabled' ? 'с Jev' : 'без Jev'}</strong>.</p><p class="muted">${pair.method === 'independently-fitted-filters' ? 'Фильтры отдельно подобраны на DEV с оценками Jev и без них, в пределах общего бюджета.' : 'Исходный AI-фильтр проверен с включённым и выключенным Jev.'} Ядро, рынок, период, расходы и направления одинаковы. Обе стороны исполнены нативным тестером; смены победителя по TEST нет.</p><div class="metrics"><div class="metric"><strong>${number(result.pnlDelta)}</strong><span>Разница PnL: с Jev минус без Jev, USDT</span></div><div class="metric"><strong>${number(result.drawdownDelta)}</strong><span>Разница просадки, USDT; меньше лучше</span></div><div class="metric"><strong>${result.jevCoverage?.scoredEvents ?? 0}</strong><span>Групп сигналов TEST с оценками Jev</span></div><div class="metric"><strong>${result.dailyPnlDeltaInterval95 ? result.dailyPnlDeltaInterval95.map(number).join(' … ') : 'н/д'}</strong><span>95% интервал средней дневной разницы PnL, USDT/день</span></div></div>${researchLineChart(charts, 'С Jev / без Jev · нативные сделки TEST')}<div class="scroll"><table><thead><tr><th>Направление</th><th>Режим</th><th>N</th><th>PnL, USDT</th><th>PF</th><th>Просадка, USDT</th></tr></thead><tbody>${(
          ['ALL', 'LONG', 'SHORT'] as const
        )
          .map((side) =>
            [result.withJev, result.withoutJev]
              .map((window, index) => {
                const m = window?.cohorts[side];
                return m
                  ? `<tr><td>${side}</td><td>${index ? 'Без Jev' : 'С Jev'}</td><td>${m.trades}</td><td>${number(m.pnl)}</td><td>${m.profitFactorStatus === 'infinite_no_gross_loss' ? '∞' : number(m.profitFactor)}</td><td>${number(m.realizedMaxDrawdown)}</td></tr>`
                  : '';
              })
              .join(''),
          )
          .join('')}</tbody></table></div>`
      : ''
  }<p class="muted">PnL учитывает торговые расходы. Историческая стоимость получения оценок Jev в него не включена. Автоматический flow использует сохранённые оценки или локальную модель и не делает новых платных запросов.</p><details><summary>Отбор на DEV</summary><p>Это диагностика независимо отобранных профилей, их направления могут различаться. Сопоставимая пара с общей маской направлений фиксируется до TEST.</p><div class="scroll"><table><thead><tr><th>Пара</th><th>PnL DEV с Jev</th><th>PnL DEV без Jev</th></tr></thead><tbody>${result.dev.map((row) => `<tr><td>${escape(row.pairId)}</td><td>${number(row.withJev?.cohorts.ALL.pnl)}</td><td>${number(row.withoutJev?.cohorts.ALL.pnl)}</td></tr>`).join('')}</tbody></table></div></details></div></section>`;
};
