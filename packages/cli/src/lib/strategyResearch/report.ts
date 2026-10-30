import type {
  ResearchConclusion,
  ResearchDataset,
  ResearchState,
  StrategyResearchSpec,
} from './types';
import type { ResearchDiagnostics } from './diagnostics';
import type { CoreResearchWindowMetrics } from '../coreResearch/types';

export const escapeResearchHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );
const number = (value: number | null) =>
  value == null ? 'н/д' : Number.isFinite(value) ? value.toFixed(3) : '∞';
const list = (values: string[]) =>
  `<ul>${values.map((value) => `<li>${escapeResearchHtml(value)}</li>`).join('')}</ul>`;

const funnel = (value: ResearchDataset['funnel']) =>
  value
    ? `<details><summary>Сигналы, входы и причины отказов</summary><p>События: ${escapeResearchHtml(JSON.stringify(value.events))}</p><p>Пропуски: ${escapeResearchHtml(JSON.stringify(value.skipCounts))}</p>${value.researchPolicy ? `<p>Отказы исследовательского фильтра: ${escapeResearchHtml(JSON.stringify(value.researchPolicy.rejections))}</p><pre>${escapeResearchHtml(JSON.stringify(value.researchPolicy.examples, null, 2))}</pre>` : ''}</details>`
    : '<p>Подробная воронка сигналов недоступна в сохранённых данных.</p>';

const table = (windows: CoreResearchWindowMetrics[]) =>
  `<div class="scroll"><table><thead><tr>${['Окно', 'Направление', 'N', 'PnL', 'PnL/сделку', 'PF', 'WR, %', 'Реализованная просадка', 'Сделок/день', 'Серия убытков'].map((label) => `<th>${label}</th>`).join('')}</tr></thead><tbody>${windows
    .flatMap((window) =>
      (['ALL', 'LONG', 'SHORT'] as const).map((side) => {
        const metrics = window.cohorts[side];
        return `<tr><td>${escapeResearchHtml(window.label)}</td><td>${side}</td><td>${metrics.trades}</td><td>${number(metrics.pnl)}</td><td>${number(metrics.pnlPerTrade)}</td><td>${metrics.profitFactorStatus === 'infinite_no_gross_loss' ? '∞' : number(metrics.profitFactor)}</td><td>${number(metrics.winRatePct)}</td><td>${number(metrics.realizedMaxDrawdown)}</td><td>${number(metrics.cadencePerDay)}</td><td>${metrics.maximumConsecutiveLosses}</td></tr>`;
      }),
    )
    .join('')}</tbody></table></div>`;

const featurePlot = (feature: ResearchDiagnostics['features'][number]) => {
  const points = feature.bins.filter(
    (bin) => bin.metrics.ALL.pnlPerTrade != null,
  );
  if (!points.length) return '<p>Нет наблюдений.</p>';
  const lows = points.map(
    (point) => point.meanInterval95?.[0] ?? point.metrics.ALL.pnlPerTrade!,
  );
  const highs = points.map(
    (point) => point.meanInterval95?.[1] ?? point.metrics.ALL.pnlPerTrade!,
  );
  const min = Math.min(0, ...lows),
    max = Math.max(0, ...highs),
    y = (value: number) =>
      200 - (160 * (value - min)) / Math.max(1e-9, max - min);
  return `<svg viewBox="0 0 940 255" role="img" aria-label="Результат по диапазонам индикатора"><path d="M45 ${y(0)}H900" stroke="#8b949e"/>${points
    .map((point, index) => {
      const x = 100 + (700 * index) / Math.max(1, points.length - 1);
      return `<path d="M${x} ${y(lows[index])}V${y(highs[index])}" stroke="#167b69"/><circle cx="${x}" cy="${y(point.metrics.ALL.pnlPerTrade!)}" r="5" fill="#167b69"/><text x="${x - 35}" y="235">${escapeResearchHtml(point.lower)}…${escapeResearchHtml(point.upper)}</text><text x="${x - 25}" y="252">N=${point.metrics.ALL.trades}</text>`;
    })
    .join(
      '',
    )}<text x="3" y="30">${number(max)}</text><text x="3" y="215">${number(min)}</text></svg><p>Средний PnL сделки и 95% интервал при повторной выборке календарных блоков. Последовательные дни и общерыночные события учитываются совместно. Это диагностика DEV.</p>`;
};

const eventFan = (summary: ResearchDiagnostics) => {
  const points = summary.eventStudy.filter(
    (row) => row.side === 'ALL' && row.samples > 0,
  );
  if (!points.length)
    return '<p>Для общего распределения движения недостаточно сохранённых свечей.</p>';
  const min = Math.min(0, ...points.map((row) => row.p10!)),
    max = Math.max(0, ...points.map((row) => row.p90!));
  const x = (index: number) =>
      90 + (700 * index) / Math.max(1, points.length - 1),
    y = (value: number) =>
      210 - (170 * (value - min)) / Math.max(1e-9, max - min);
  const polygon = [
    ...points.map((row, index) => `${x(index)},${y(row.p10!)}`),
    ...points.map((row, index) => `${x(index)},${y(row.p90!)}`).reverse(),
  ].join(' ');
  return `<svg viewBox="0 0 940 260" role="img" aria-label="Историческое распределение движения после события"><polygon points="${polygon}" fill="#d9e9e5"/><polyline points="${points.map((row, index) => `${x(index)},${y(row.median!)}`).join(' ')}" fill="none" stroke="#167b69" stroke-width="3"/><path d="M50 ${y(0)}H880" stroke="#8b949e"/>${points.map((row, index) => `<text x="${x(index) - 25}" y="242">${row.bars} баров</text><text x="${x(index) - 25}" y="258">N=${row.samples}</text>`).join('')}<text x="3" y="30">${number(max)}R</text><text x="3" y="215">${number(min)}R</text></svg><p>Медиана и процентили 10/90 последующего движения доступных событий DEV. Это историческое распределение, не прогноз будущей цены. Комиссии в движении цены не вычтены; торговый результат после расходов показан отдельно.</p>`;
};

const polyline = (values: Array<[number, number]>, title: string) => {
  if (!values.length)
    return `<p>${escapeResearchHtml(title)}: нет наблюдений.</p>`;
  const minimumX = values[0][0],
    maximumX = values.at(-1)![0];
  const minY = values.reduce(
    (minimum, value) => Math.min(minimum, value[1]),
    0,
  );
  const maxY = values.reduce(
    (maximum, value) => Math.max(maximum, value[1]),
    0,
  );
  const x = (value: number) =>
    50 + (850 * (value - minimumX)) / Math.max(1, maximumX - minimumX);
  const y = (value: number) =>
    210 - (170 * (value - minY)) / Math.max(1e-9, maxY - minY);
  const steps = values
    .map(
      (value, index) =>
        `${index ? `H${x(value[0])} V${y(value[1])}` : `M${x(value[0])},${y(value[1])}`}`,
    )
    .join(' ');
  return `<svg viewBox="0 0 940 250" role="img" aria-label="${escapeResearchHtml(title)}"><title>${escapeResearchHtml(title)}</title><path d="M50 ${y(0)}H900" stroke="#8b949e"/><path d="${steps}" fill="none" stroke="#167b69" stroke-width="2"/><text x="4" y="35">${number(maxY)}</text><text x="4" y="225">${number(minY)}</text><text x="50" y="245">${new Date(minimumX).toISOString().slice(0, 10)}</text><text x="800" y="245">${new Date(maximumX).toISOString().slice(0, 10)}</text></svg>`;
};

export const buildResearchCaseSvg = (
  sample: ResearchDataset['samples'][number],
  reveal: boolean,
) => {
  const candles = sample.candles.filter(
    (candle) => reveal || candle.timestamp <= sample.trade.signalTimestamp,
  );
  if (!candles.length) return '<p>Свечи недоступны.</p>';
  const levels = [sample.stop, sample.target].filter(
    (value): value is number => value != null,
  );
  const min = Math.min(...candles.map((candle) => candle.low), ...levels),
    max = Math.max(...candles.map((candle) => candle.high), ...levels);
  const y = (value: number) =>
    220 - (180 * (value - min)) / Math.max(1e-12, max - min);
  const x = (index: number) =>
    45 + (830 * index) / Math.max(1, candles.length - 1);
  const signal = candles.findIndex(
    (candle) => candle.timestamp === sample.trade.signalTimestamp,
  );
  return `<svg viewBox="0 0 940 265" role="img" aria-label="${reveal ? 'После события' : 'На момент решения'}"><title>${reveal ? 'После события' : 'На момент решения'}</title>${candles.map((candle, index) => `<path d="M${x(index)} ${y(candle.high)}V${y(candle.low)}M${x(index) - 3} ${y(candle.open)}h3M${x(index)} ${y(candle.close)}h3" stroke="${candle.close >= candle.open ? '#167b69' : '#bd3434'}"/>`).join('')}${levels.map((level) => `<path d="M40 ${y(level)}H900" stroke="#8b949e" stroke-dasharray="4 4"/><text x="4" y="${y(level)}">${number(level)}</text>`).join('')}${signal >= 0 ? `<path d="M${x(signal)} 30V230" stroke="#234db6" stroke-dasharray="4 4"/>` : ''}<text x="45" y="255">${new Date(candles[0].timestamp).toISOString()}</text></svg>`;
};

export const buildStrategyResearchReport = (parameters: {
  spec: StrategyResearchSpec;
  state: ResearchState;
  conclusion?: ResearchConclusion;
  rawReports?: Record<string, CoreResearchWindowMetrics[]>;
  diagnostics?: Array<{
    id: string;
    summary: ResearchDiagnostics;
    samples: ResearchDataset['samples'];
  }>;
}) => {
  const { spec, state, conclusion } = parameters;
  const labels = {
    'data-error': 'Ошибка данных или исполнения',
    rejected: 'Кандидат отклонён',
    'insufficient-data': 'Недостаточно независимых данных',
    'candidate-confirmed': 'Кандидат подтверждён в заданных условиях',
  };
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Исследование ${escapeResearchHtml(spec.core.strategy)}</title><style>body{font:16px/1.55 system-ui;max-width:1180px;margin:32px auto;padding:0 20px;color:#203038;background:#fafbf9}h1{font-size:30px}h2{font-size:23px;margin-top:36px}.card{background:white;border:1px solid #d7e0dd;border-radius:8px;padding:18px;margin:18px 0}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:right;padding:8px;border-bottom:1px solid #e0e6e2;white-space:nowrap}th:first-child,td:first-child{text-align:left}svg{width:100%;height:auto;background:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}summary{cursor:pointer}a{color:#176c60}</style><body>
  <h1>${escapeResearchHtml(spec.core.strategy)}: итог исследования</h1>${state.lineage.fixture ? '<p><strong>Синтетические данные для проверки процесса. Это не результат исследования рынка.</strong></p>' : ''}<div class="card"><strong>${conclusion ? labels[conclusion.status] : state.status === 'failed' ? 'Ошибка процесса' : 'Исследование выполняется'}</strong>${list(conclusion?.reasons ?? [state.error ?? 'Результат ещё не получен'])}<p>Следующий шаг: ${escapeResearchHtml(conclusion?.nextAction ?? 'Возобновить тот же запуск после устранения причины ошибки.')}</p><p>Выбранный кандидат: ${escapeResearchHtml(conclusion?.selectedId ?? 'нет')}.</p></div>
  <p>${escapeResearchHtml(spec.core.hypothesis.claim)} Механизм: ${escapeResearchHtml(spec.core.hypothesis.mechanism)}</p><p>Окно: ${new Date(spec.core.window.start).toISOString()} — ${new Date(spec.core.window.end).toISOString()}. Общая граница TEST: ${spec.testSince ? new Date(spec.testSince).toISOString() : 'будет определена по группам времени 60/40'}. USDT-инструментов: ${spec.core.universe.symbols.length}. Риск независимой сделки: ${spec.core.execution.maxLossValue} USDT.</p>
  ${
    conclusion
      ? `<h2>Сравнение на TEST</h2><div class="scroll"><table><thead><tr><th>Вариант</th><th>Сделок</th><th>PnL, USDT</th><th>PF</th><th>Просадка, USDT</th><th>Критерии TEST</th></tr></thead><tbody>${conclusion.evaluations
          .map((item) => {
            const m = item.windows.find((window) => window.label === 'TEST')!
              .cohorts.ALL;
            return `<tr><td>${escapeResearchHtml(item.id)}</td><td>${m.trades}</td><td>${number(m.pnl)}</td><td>${m.profitFactorStatus === 'infinite_no_gross_loss' ? '∞' : number(m.profitFactor)}</td><td>${number(m.realizedMaxDrawdown)}</td><td>${item.passed ? 'пройдены' : 'не пройдены'}</td></tr>`;
          })
          .join('')}</tbody></table></div>`
      : ''
  }
  <details><summary>Ход работы: ${Object.values(state.stages).filter((stage) => stage.status === 'completed').length} этапов завершено</summary><ol>${Object.entries(
    state.stages,
  )
    .map(
      ([name, stage]) =>
        `<li>${escapeResearchHtml(name)}: ${stage.status === 'completed' ? 'завершён' : stage.status === 'failed' ? 'ошибка' : 'в работе'} ${stage.error ? escapeResearchHtml(stage.error) : ''}</li>`,
    )
    .join('')}</ol></details>
  <details><summary>Условия и ограничения</summary>${list(['Проверка относится к фиксированному набору инструментов. Исторический состав биржи не восстанавливается по наличию свечей.', spec.history === 'retrospective' ? 'История уже изучалась; повторное разделение не создаёт независимый тест.' : 'Независимость зависит от заявленной истории использования данных и проверяется по доступному журналу.', 'Фильтры исполняются до постановки отложенного входа; позиции пересчитываются в родном тестере.', 'Ограничение общего риска проверяется проекцией по исполненным сделкам. Если оно меняет состав сделок, подтверждение блокируется.', 'Просадка ALL относится к общей кривой закрытых сделок; LONG/SHORT — к соответствующему направлению. Внутрисделочная переоценка капитала не вычисляется.', 'Распределения и изображения DEV объясняют прошлые события. Будущие свечи не входят в правила входа.', 'Интервалы распределений служат диагностикой. Итог означает прохождение зафиксированных критериев, а не гарантию будущей прибыли. Публикация и реальные сделки не выполняются.'])}</details>
  ${conclusion ? `<p>Попытки: ${escapeResearchHtml(JSON.stringify(conclusion.trials))}. Итоговый вариант выбран на DEV до открытия TEST; смены победителя по TEST нет.</p>` : ''}
  ${
    parameters.rawReports
      ? `<details><summary>Результаты ядра до исследовательских фильтров</summary>${Object.entries(
          parameters.rawReports,
        )
          .map(
            ([id, windows]) =>
              `<h2>${escapeResearchHtml(id)}</h2>${table(windows)}`,
          )
          .join('')}</details>`
      : ''
  }
  ${(conclusion?.evaluations ?? []).map((evaluation) => `<section class="card"><h2>${escapeResearchHtml(evaluation.id)} — ${evaluation.policy.mode === 'current-gate' ? 'исходный фильтр' : 'собственный фильтр'}</h2>${list(evaluation.reasons.length ? evaluation.reasons : ['Зафиксированные экономические критерии пройдены'])}${funnel(evaluation.funnel)}<details><summary>Метрики ALL / LONG / SHORT по всем окнам</summary>${table([...evaluation.windows, evaluation.stress])}</details><p>Независимых событий TEST: ${evaluation.testEvents}. Максимальная доля события: ${number(evaluation.eventShare * 100)}%; инструмента: ${number(evaluation.symbolShare * 100)}%. Проекция лимита риска отклонила ${evaluation.capacity.rejected} сделок.</p>${polyline(evaluation.equity, 'Накопленная реализованная прибыль')}<details><summary>Точное правило</summary><pre>${escapeResearchHtml(JSON.stringify(evaluation.policy, null, 2))}</pre></details></section>`).join('')}
  ${(parameters.diagnostics ?? [])
    .map(
      ({ id, summary, samples }) =>
        `<section><h2>Диагностика DEV: ${escapeResearchHtml(id)}</h2><p>Исключено незрелых исходов: ${summary.purgedLabels}. Записанные признаки Jev: ${summary.jev.availableRows}/${summary.jev.totalRows}. Новые запросы к модели не выполнялись.</p>${eventFan(summary)}<details><summary>Распределения индикаторов и результаты по диапазонам</summary>${summary.features.map((feature) => `<h3>${escapeResearchHtml(feature.key)}</h3>${featurePlot(feature)}<p>Покрытие ${number(feature.coverage * 100)}%. P10/P90 ниже — разброс исходов, а не доверительный интервал среднего.</p>${feature.bins.map((bin, index) => `<p>Диапазон ${index + 1}: ${escapeResearchHtml(bin.lower)} — ${escapeResearchHtml(bin.upper)}; событий ${bin.events}; исходы P10/P90: ${number(bin.outcomeP10)}/${number(bin.outcomeP90)}</p>${table([{ label: 'DEV bin', start: spec.core.window.start, end: spec.testSince, periodDays: (spec.testSince - spec.core.window.start) / 86400000, cohorts: bin.metrics }])}`).join('')}`).join('')}</details><details><summary>Примеры графиков: сначала решение, затем раскрытие исхода</summary>${samples
          .map(
            (sample) =>
              `<article class="card"><p>${escapeResearchHtml(sample.trade.symbol)} ${sample.trade.direction}; ${new Date(sample.trade.signalTimestamp).toISOString()}</p>${buildResearchCaseSvg(sample, false)}<details><summary>Показать дальнейшее движение и результат</summary><p>PnL ${number(sample.trade.netProfit)}</p>${buildResearchCaseSvg(sample, true)}<pre>${escapeResearchHtml(
                JSON.stringify(
                  summary.paths.find(
                    (item) => item.signalId === sample.trade.signalId,
                  ),
                  null,
                  2,
                ),
              )}</pre></details></article>`,
          )
          .join(
            '',
          )}<p>Примеры отобраны отдельно по направлениям и исходам. Их нельзя использовать как оценку частоты рынка.</p></details></section>`,
    )
    .join('')}
  <details><summary>Зафиксированные условия, издержки и бюджет</summary><pre>${escapeResearchHtml(JSON.stringify(spec, null, 2))}</pre></details><h2>Воспроизведение</h2><p><a href="spec.json">Условия</a> · <a href="result.json">Полный результат</a> · <a href="state.json">Этапы и контрольные суммы</a> · <a href="retention-status.json">Состояние очистки</a></p><details><summary>Исходники и исполняемые модули</summary><pre>${escapeResearchHtml(JSON.stringify(state.lineage, null, 2))}</pre></details></body></html>`;
};
