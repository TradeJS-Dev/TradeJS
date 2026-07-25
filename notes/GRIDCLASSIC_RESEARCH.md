# GridClassic: pre-gate research

Дата исследования: 2026-07-23.

## Итог

`GridClassic` реализована как отдельная replay-safe стратегия mean reversion
для Bybit USDT perpetual, 15m. Финальный исследовательский кандидат не является
стабильным или прибыльным:

- 30d: 58 завершённых циклов, 55 тикеров, net P&L `-$82.59`;
- 180d: 243 завершённых цикла, 185 тикеров, net P&L `-$290.18`;
- старая и новая половины 180d отрицательны;
- 180d частота ниже исследовательского ориентира в 300 циклов;
- до комиссии и проскальзывания 180d результат также отрицателен:
  около `-$50.67`;
- AI-export и Redis-конфиг `GridClassic:ai` не создавались.

Лучший исследованный pre-gate конфиг сохранён в Redis:

- `users:root:backtests:configs:GridClassic:research`;
- `users:root:backtests:configs:GridClassic:best-pregate-20260723`.

Оба ключа содержат одинаковый frozen-кандидат с `AI_ENABLED=false`,
`ML_ENABLED=false`, `MAX_LOSS_VALUE=10`, LONG/SHORT enabled и
`GRIDCLASSIC_RISK_SLIPPAGE_BPS=10`.

## Логика стратегии

Стратегия ищет подтверждённый причинный диапазон:

1. Pivot high/low подтверждается только после `rightBars`.
2. По подтверждённым pivot строятся отдельные линейные регрессии верхней и
   нижней границы.
3. Диапазон допускается только после проверок ширины в ATR, наклона центра,
   расхождения границ, containment, возраста и режима волатильности.
4. LONG разрешён только в нижней edge-zone, SHORT — только в верхней.
5. Вход требует причинного rejection/close-inside подтверждения.
6. После входа границы, stop, target и виртуальные grid-levels фиксируются до
   завершения цикла.
7. Следующий уровень создаёт один market-entry с
   `positionIntent: "increase"` только после достижения этого уровня.
   Gap через несколько уровней не порождает несколько исполнений на одной
   свече.
8. Количество, notional и worst-case риск следующего уровня не могут быть
   больше предыдущего. В расчёт полной серии включены комиссии и 10 bps
   проскальзывания на каждой стороне.
9. Добавления прекращаются при adverse breakout или после восстановления
   цены; stop не может расширяться.
10. Выходы: center/opposite-edge TP, hard stop, подтверждённый breakout,
    invalid range, volatility shock и max hold.

Detector и состояние цикла используют `strategyApi.createStateController`.
`initialCandles` проходят тот же `next(candle)` transition path, что и live
свечи; повторный timestamp идемпотентен; история ограничена.

Общая причинная геометрия вынесена в
`packages/strategies/src/shared/causalRangeGeometry.ts`. Существующий `Grid`
использует совместимый wrapper, сохраняющий его публичный интерфейс и
поведение range-filter.

## Figures и AI-контекст

Figures содержат:

- подтверждённые pivot;
- upper/lower boundaries и center;
- edge-zones;
- все виртуальные уровни и фактически исполненные уровни;
- entry, stop loss и take profit;
- breakout/invalidation point, когда он доступен.

`adapters/ai.ts` переносит в будущий export геометрию диапазона, положение
цены, width/slope/containment/divergence, pivot counts, age, direction,
grid-level, filled/remaining levels, расстояния до границ/центра/stop и
rejection/breakout/volatility признаки. Сам AI-gate не добавлен и в
исследовании не использовался.

## Подбор параметров

Подбор выполнялся небольшими последовательными sweep, без одновременной
оптимизации всех параметров:

| Этап | Изменяемые параметры | Результат |
| --- | --- | --- |
| Baseline 30d | исходный permissive range | avg P&L по символу `-$9.35`, win rate 28.5% |
| Range | confirmation, wick, containment, max slope | лучший range: containment `0.90`, slope `0.015`; avg `-$0.50` |
| Exit | stop buffer `1/1.5 ATR`, breakout confirm `1/2` | лучший: stop `1.5 ATR`, confirm `1`; avg `-$0.31` |
| Entry | edge `0.12/0.18/0.22`, wick `1.5/2.0` | edge `0.12`, wick `2.0` дал только 44 цикла; выбран wick `1.5` с 58 циклами |
| Grid/TP | center/opposite, size decay `0.6/1.0` | center и равные размеры лучше; decay `0.6` заметно хуже |
| Step | `0.3/0.5/0.7 ATR` | лучший 30d результат у `0.3 ATR` |

Финальные параметры:

| Группа | Значение |
| --- | --- |
| Pivot | left/right `3/3`, lookback `96`, min pivots `3` на сторону |
| Range width | `3..14 ATR` |
| Range quality | max center slope `0.015 ATR/bar`, max divergence `0.8 ATR`, containment `0.90` |
| Range age/volatility | min age `32`, max expansion `1.8`, max candle range `3 ATR` |
| Entry | edge `0.12`, `rejection`, min wick ratio `1.5` |
| Grid | 4 уровня, step `max(0.3 ATR, 0.1 range)`, decay `1.0` |
| Protection | stop `1.5 ATR`, breakout confirm `1`, invalidation `3` |
| Exit | TP `center`, max hold `192` bars, cooldown `16` bars |
| Risk | `MAX_LOSS_VALUE=10`, fee `10 bps`, risk slippage `10 bps` |

На ранних sweep risk-sizing резервировал 3 bps, хотя фактическая execution
model применяла 10 bps. Перед финальной проверкой это было исправлено:
стратегия и оба frozen Redis-конфига теперь резервируют 10 bps. Все итоговые
30/60/90/180d результаты ниже получены после исправления. Sweep-отчёты
используются только как история выбора параметров, не как финальная оценка
риска.

## Backtest-отчёты

Подбор:

- `data/backtests/output/202607231346-GridClassic-research.md`
- `data/backtests/output/202607231348-GridClassic-research-range.md`
- `data/backtests/output/202607231350-GridClassic-research-candidate-a.md`
- `data/backtests/output/202607231353-GridClassic-research-exit.md`
- `data/backtests/output/202607231355-GridClassic-research-entry.md`
- `data/backtests/output/202607231403-GridClassic-research-grid.md`
- `data/backtests/output/202607231406-GridClassic-research-step.md`

Финальная проверка с 10 bps risk slippage:

| Окно | Run ID | Отчёт |
| --- | --- | --- |
| 30d | `202607231426-1b484bc7` | `data/backtests/output/202607231427-GridClassic-best-pregate-20260723.md` |
| 60d | `202607231427-a25a9a42` | `data/backtests/output/202607231429-GridClassic-best-pregate-20260723.md` |
| 90d | `202607231429-21e3bc7f` | `data/backtests/output/202607231432-GridClassic-best-pregate-20260723.md` |
| 180d | `202607231432-fe205a25` | `data/backtests/output/202607231434-GridClassic-best-pregate-20260723.md` |
| Old 90d | `202607231435-a19ade9c` | `data/backtests/output/202607231436-GridClassic-best-pregate-20260723.md` |
| New 90d | `202607231437-eab53c1a` | `data/backtests/output/202607231438-GridClassic-best-pregate-20260723.md` |
| 180d detailed audit | `202607231442-62f113cc` | `data/backtests/output/202607231444-GridClassic-best-pregate-20260723.md` |

Все прогоны: Bybit, полный доступный universe из 512 тикеров, 15m,
`--cacheOnly`, AI/ML disabled, 512/512 success, 0 errors. Detailed audit
повторяет frozen 180d конфиг без `--fast` и сохраняет order logs.

## Финальные метрики

Основные P&L и counts взяты из отдельных exact-окон. Direction, duration,
profit factor, exit/cost split получены из единого 180d detailed audit.
Из-за разницы граничных секунд и округления order logs детализация может
отличаться от отдельного окна на несколько центов.

| Окно | Циклы | Тикеры | LONG, P&L | SHORT, P&L | Win rate | Net P&L | Avg/cycle | PF | Max chronological DD | Avg hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30d | 58 | 55 | 32, `-$41.26` | 26, `-$41.33` | 15.52% | `-$82.59` | `-$1.42` | 0.096 | `$82.59` / 1.50% active capital | 0.59h |
| 60d | 93 | 85 | 49, `-$64.84` | 44, `-$60.72` | 18.28% | `-$125.59` | `-$1.35` | 0.119 | `$125.56` / 1.48% | 0.55h |
| 90d | 133 | 113 | 73, `-$96.33` | 60, `-$69.89` | 23.31% | `-$166.31` | `-$1.25` | 0.140 | `$166.81` / 1.48% | 0.55h |
| 180d | 243 | 185 | 138, `-$163.83` | 105, `-$126.32` | 24.69% | `-$290.18` | `-$1.19` | 0.153 | `$290.15` / 1.57% | 0.54h |

`active capital` для сопоставимого DD — `$100 × число тикеров со сделками`.
Худший суммарный результат одного тикера на 180d: `ROAMUSDT -$10.27`;
это не означает нарушения риска отдельного цикла, поскольку на тикере было
несколько циклов.

### Exit split

| Окно | TP | SL | Inferred breakout | Other strategy exit |
| --- | --- | --- | --- | --- |
| 30d | 8 / `+$7.94` | 6 / `-$19.37` | 32 / `-$64.83` | 12 / `-$6.33` |
| 60d | 14 / `+$14.08` | 8 / `-$25.61` | 52 / `-$106.87` | 19 / `-$7.16` |
| 90d | 26 / `+$22.76` | 11 / `-$38.72` | 67 / `-$138.82` | 29 / `-$11.44` |
| 180d | 46 / `+$42.42` | 21 / `-$75.10` | 121 / `-$240.13` | 55 / `-$17.34` |

TP/SL определяются по типу order log. `CLOSE_*` классифицируется как breakout,
если execution price вышла за frozen entry-boundary плюс настроенный
breakout tolerance. Остальные `CLOSE_*` объединены в `Other strategy exit`:
TestConnector не сохраняет `strategyApi.exit` code, поэтому invalid range,
volatility shock и max hold нельзя честно разделить постфактум.

Основная слабость — adverse breakout: 121 из 243 циклов и `-$240.13`.

### Grid depth

| Окно | 1 исполненный уровень | 2 исполненных уровня | 3–4 уровня |
| --- | --- | --- | --- |
| 30d | 54 / `-$76.37` | 4 / `-$6.22` | 0 |
| 60d | 86 / `-$112.69` | 7 / `-$12.87` | 0 |
| 90d | 124 / `-$142.67` | 9 / `-$23.55` | 0 |
| 180d | 230 / `-$258.01` | 13 / `-$32.14` | 0 |

Сетка почти всегда остаётся одноуровневой: пробой/выход наступает раньше
глубокого набора. Увеличивать размер уровней для компенсации запрещено
risk-моделью и превратило бы стратегию в мартингейл.

### Комиссии и проскальзывание

Execution model: taker fee 10 bps и base slippage 10 bps на каждой операции.

| Окно | Net P&L | Fees | Modelled slippage | P&L до этих затрат |
| --- | ---: | ---: | ---: | ---: |
| 30d | `-$82.59` | `$30.33` | `$30.33` | `-$21.93` |
| 60d | `-$125.59` | `$48.08` | `$48.08` | около `-$29.41` |
| 90d | `-$166.31` | `$68.94` | `$68.94` | около `-$28.33` |
| 180d | `-$290.18` | `$119.74` | `$119.74` | около `-$50.67` |

Стоимость исполнения очень велика относительно коротких mean-reversion
движений, но не является единственной причиной: pre-cost P&L отрицателен на
всех окнах.

### Концентрация по тикерам

Поскольку общий результат отрицателен, концентрация измерена как доля пяти
лучших тикеров в сумме всех положительных ticker-P&L:

| Окно | Top-5 share положительного P&L | Лучшие тикеры |
| --- | ---: | --- |
| 30d | 86.21% | YFI, AT, PARTI, XPLUS, RAVE |
| 60d | 56.75% | ALCH, YFI, AT, PARTI, ZORA |
| 90d | 39.86% | ALCH, YFI, RAVE, PARTI, ZORA |
| 180d | 25.86% | GRIFFAIN, VVV, CYBER, ALCH, ONG |

На коротком терминальном окне редкие выигрыши сильно концентрированы, но
убыток распределён широко. Худшие 180d тикеры: ROAM `-$10.27`, WIF `-$9.91`,
WHITEWHALE `-$7.08`, 1000TAG `-$5.92`, POL `-$5.74`.

## Time-ordered stability

Старая и новая половины используют непересекающиеся окна:

- old: 2026-01-24 14:32:11 — 2026-04-24 14:32:11;
- new: 2026-04-24 14:32:11 — 2026-07-23 14:32:11.

| Срез | Циклы | Тикеры | Win rate | Net P&L | Avg/cycle | PF |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Old 90d | 110 | 97 | 26.36% | `-$123.88` | `-$1.13` | 0.170 |
| New 90d | 133 | 113 | 23.31% | `-$166.31` | `-$1.25` | 0.140 |
| Last 60d | 93 | 85 | 18.28% | `-$125.59` | `-$1.35` | 0.119 |
| Last 30d | 58 | 55 | 15.52% | `-$82.59` | `-$1.42` | 0.096 |

Качество ухудшается к терминальному окну. Стратегия не держится на одном
положительном режиме: положительного режима в проверенных срезах нет.

Ориентиры частоты:

- 30d: 55 тикеров и 58 циклов — оба ориентира выполнены;
- 180d: 243 цикла — на 57 ниже ориентира 300.

## Reject/skip причины

Backtest-runner не сохраняет частоты skip-событий, поэтому количественная
разбивка не заявляется. Реализованные диагностические причины:

- warmup / range not ready;
- range not detected по width, slope, divergence, containment, age;
- нет edge confirmation или цена после delayed fill вышла из edge-zone;
- volatility shock;
- cooldown;
- order pending / ожидание следующего уровня;
- additions stopped после breakout/recovery;
- exhausted risk budget;
- invalid geometry/grid plan или disabled side.

## Слабые места и решение по AI-export

1. Подтверждённый range слишком часто завершается breakout почти сразу после
   edge-entry.
2. Низкий win rate и PF сохраняются на обеих сторонах и во всех окнах.
3. Короткий target делает комиссию и slippage сопоставимыми с потенциальным
   возвратом к центру.
4. Четырёхуровневая сетка фактически не реализует глубокое усреднение:
   230/243 циклов имеют один уровень, а уровней 3–4 нет.
5. Более широкая edge-zone даёт больше слабых входов; более строгая не
   обеспечивает нужную частоту.
6. 180d sample не достигает ориентира 300 циклов.
7. Последние 30/60d хуже старой половины, поэтому terminal stability
   отсутствует.

Переходить к AI-export нельзя. Сначала нужна новая pre-gate гипотеза,
улучшающая причинное распознавание ложного edge-rejection против начинающегося
breakout и остающаяся положительной после execution costs. Добавление AI-gate
к текущему отрицательному baseline только скроет отсутствие самостоятельного
edge и не удовлетворит критерию исследования.
