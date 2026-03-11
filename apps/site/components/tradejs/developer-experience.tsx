'use client';

import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import { useMemo, useState } from 'react';
import { useLocale } from './locale-provider';
import { AnimateOnScroll } from './animate-on-scroll';

const pineScript = (hljsApi: typeof hljs) => ({
  name: 'Pine Script',
  aliases: ['pine'],
  keywords: {
    keyword:
      'indicator strategy if else for while switch case break continue return import as and or not',
    literal: 'true false na',
    built_in:
      'input plot ta math color request strategy close open high low volume timeframe',
  },
  contains: [
    hljsApi.C_LINE_COMMENT_MODE,
    hljsApi.APOS_STRING_MODE,
    hljsApi.QUOTE_STRING_MODE,
    hljsApi.C_NUMBER_MODE,
  ],
});

if (!hljs.getLanguage('typescript')) {
  hljs.registerLanguage('typescript', typescript);
}

if (!hljs.getLanguage('pine')) {
  hljs.registerLanguage('pine', pineScript);
}

const tsCode = `import { CreateStrategyCore } from '@tradejs/core';
import { EMA } from 'technicalindicators';

export const createMyStrategyCore: CreateStrategyCore<
  MyStrategyConfig
> = async ({ strategyApi, config, data }) => {
  const fastLen = Number(config.EMA_FAST ?? 9);
  const slowLen = Number(config.EMA_SLOW ?? 21);
  const closes = data.map((candle) => candle.close);

  const emaFast = new EMA({ period: fastLen, values: closes });
  const emaSlow = new EMA({ period: slowLen, values: closes });

  return async (candle) => {
    const currentPrice = candle.close;
    emaFast.nextValue(currentPrice);
    emaSlow.nextValue(currentPrice);

    if (await strategyApi.isCurrentPositionExists()) {
      return strategyApi.skip('POSITION_EXISTS');
    }

    const fast = emaFast.getResult().slice(-2);
    const slow = emaSlow.getResult().slice(-2);

    if (fast.length < 2 || slow.length < 2) {
      return strategyApi.skip('WAIT_EMA_DATA');
    }

    const [fastPrev, fastCurrent] = fast;
    const [slowPrev, slowCurrent] = slow;

    const entryLong = fastPrev <= slowPrev && fastCurrent > slowCurrent;
    const entryShort = fastPrev >= slowPrev && fastCurrent < slowCurrent;

    if (!entryLong && !entryShort) {
      return strategyApi.skip('NO_EMA_CROSS');
    }

    const direction = entryLong ? 'LONG' : 'SHORT';
    const { stopLossPrice, takeProfitPrice, qty } =
      strategyApi.getDirectionalTpSlPrices({
        price: currentPrice,
        direction,
        takeProfitDelta: 2,
        stopLossDelta: 1,
        unit: 'percent',
      });

    return strategyApi.entry({
      direction,
      indicators: {
        emaFast: fastCurrent,
        emaSlow: slowCurrent,
      },
      orderPlan: {
        qty,
        stopLossPrice,
        takeProfits: [{ rate: 1, price: takeProfitPrice }],
      },
    });
  };
};`;

const pineCode = `//@version=5
indicator("EMA Cross (TradeJS)", overlay=true)

fastLen = input.int(9, "Fast EMA Length")
slowLen = input.int(21, "Slow EMA Length")

emaFast = ta.ema(close, fastLen)
emaSlow = ta.ema(close, slowLen)

entryLong = ta.crossover(emaFast, emaSlow)
entryShort = ta.crossunder(emaFast, emaSlow)
invalidated = false

plot(emaFast, "emaFast")
plot(emaSlow, "emaSlow")
plot(invalidated ? 1 : 0, "invalidated")
plot(entryLong ? 1 : 0, "entryLong")
plot(entryShort ? 1 : 0, "entryShort")`;

export function DeveloperExperience() {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<'ts' | 'pine'>('ts');
  const highlightedTsCode = useMemo(
    () => hljs.highlight(tsCode, { language: 'typescript' }).value,
    [],
  );
  const highlightedPineCode = useMemo(
    () => hljs.highlight(pineCode, { language: 'pine' }).value,
    [],
  );
  const isTsTab = activeTab === 'ts';
  const highlightedCode = isTsTab ? highlightedTsCode : highlightedPineCode;

  return (
    <section id="dev-experience" className="relative py-24 lg:py-32">
      <div className="absolute inset-0 grid-pattern-fine opacity-30" />
      <div className="relative z-10 mx-auto max-w-5xl px-4 lg:px-8">
        <AnimateOnScroll>
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
              {t.devExperience.sectionTitle}
            </h2>
            <p className="mt-4 text-muted-foreground text-base lg:text-lg max-w-2xl mx-auto text-pretty">
              {t.devExperience.sectionSubtitle}
            </p>
          </div>
        </AnimateOnScroll>

        <AnimateOnScroll delay={100}>
          <div className="rounded-xl border border-border bg-surface/60 overflow-hidden backdrop-blur-sm">
            {/* Tabs */}
            <div className="flex border-b border-border">
              <button
                onClick={() => setActiveTab('ts')}
                className={`flex-1 px-6 py-3 text-sm font-semibold transition-colors ${
                  activeTab === 'ts'
                    ? 'text-primary border-b-2 border-primary bg-surface/80'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-label="Show TypeScript example"
              >
                {t.devExperience.tsTab}
              </button>
              <button
                onClick={() => setActiveTab('pine')}
                className={`flex-1 px-6 py-3 text-sm font-semibold transition-colors ${
                  activeTab === 'pine'
                    ? 'text-primary border-b-2 border-primary bg-surface/80'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                aria-label="Show Pine Script example"
              >
                {t.devExperience.pineTab}
              </button>
            </div>

            {/* Code block */}
            <div className="p-6 overflow-x-auto">
              <pre className="hljs m-0 bg-transparent p-0 font-mono text-sm leading-relaxed text-foreground/90">
                <code
                  className={isTsTab ? 'language-typescript' : 'language-pine'}
                  dangerouslySetInnerHTML={{ __html: highlightedCode }}
                />
              </pre>
            </div>

            {/* Bottom bar */}
            <div className="flex items-center justify-between border-t border-border px-6 py-3 bg-surface-2/50">
              <span className="text-xs text-muted-foreground font-mono">
                {activeTab === 'ts' ? 'strategy.ts' : 'strategy.pine'}
              </span>
              <span className="text-xs text-muted-foreground">
                {activeTab === 'ts' ? 'TypeScript' : 'Pine Script v5'}
              </span>
            </div>
          </div>
        </AnimateOnScroll>
      </div>
    </section>
  );
}
