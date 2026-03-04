"use client"

import { useState } from "react"
import { useLocale } from "./locale-provider"
import { AnimateOnScroll } from "./animate-on-scroll"

const tsCode = `import { Strategy, StrategyConfig } from 'tradejs'

const config: StrategyConfig = {
  symbol: 'BTCUSDT',
  timeframe: '1h',
  capital: 10_000,
}

export default class MACrossover extends Strategy {
  maFast = this.sma(this.close, 9)
  maSlow = this.sma(this.close, 21)

  next() {
    if (this.maFast.crossOver(this.maSlow)) {
      this.buy({ size: 0.5 })
    }
    if (this.maFast.crossUnder(this.maSlow)) {
      this.sell()
    }
  }
}`

const pineCode = `//@version=5
strategy("MA Crossover", overlay=true)

fastLen = input.int(9, "Fast MA Length")
slowLen = input.int(21, "Slow MA Length")

maFast = ta.sma(close, fastLen)
maSlow = ta.sma(close, slowLen)

plot(maFast, color=color.teal, linewidth=2)
plot(maSlow, color=color.orange, linewidth=2)

longCond  = ta.crossover(maFast, maSlow)
shortCond = ta.crossunder(maFast, maSlow)

if longCond
    strategy.entry("Long", strategy.long)

if shortCond
    strategy.close("Long")`

export function DeveloperExperience() {
  const { t } = useLocale()
  const [activeTab, setActiveTab] = useState<"ts" | "pine">("ts")

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
                onClick={() => setActiveTab("ts")}
                className={`flex-1 px-6 py-3 text-sm font-semibold transition-colors ${
                  activeTab === "ts"
                    ? "text-primary border-b-2 border-primary bg-surface/80"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Show TypeScript example"
              >
                {t.devExperience.tsTab}
              </button>
              <button
                onClick={() => setActiveTab("pine")}
                className={`flex-1 px-6 py-3 text-sm font-semibold transition-colors ${
                  activeTab === "pine"
                    ? "text-primary border-b-2 border-primary bg-surface/80"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label="Show Pine Script example"
              >
                {t.devExperience.pineTab}
              </button>
            </div>

            {/* Code block */}
            <div className="p-6 overflow-x-auto">
              <pre className="font-mono text-sm leading-relaxed text-foreground/90">
                <code>{activeTab === "ts" ? tsCode : pineCode}</code>
              </pre>
            </div>

            {/* Bottom bar */}
            <div className="flex items-center justify-between border-t border-border px-6 py-3 bg-surface-2/50">
              <span className="text-xs text-muted-foreground font-mono">
                {activeTab === "ts" ? "strategy.ts" : "strategy.pine"}
              </span>
              <span className="text-xs text-muted-foreground">
                {activeTab === "ts" ? "TypeScript" : "Pine Script v5"}
              </span>
            </div>
          </div>
        </AnimateOnScroll>
      </div>
    </section>
  )
}
