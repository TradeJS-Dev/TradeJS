"use client"

import { useLocale } from "./locale-provider"
import { AnimateOnScroll } from "./animate-on-scroll"

export function FinalCta() {
  const { locale, t } = useLocale()

  const quickstartUrl =
    locale === "ru"
      ? "https://docs.tradejs.dev/ru/getting-started/quickstart"
      : "https://docs.tradejs.dev/getting-started/quickstart"

  return (
    <section className="relative py-24 lg:py-32">
      <div className="absolute inset-0 grid-pattern opacity-30" />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-15"
        style={{
          background: "radial-gradient(circle, rgba(32,197,189,0.2) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-3xl px-4 text-center lg:px-8">
        <AnimateOnScroll>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl text-balance">
            {t.finalCta.title}
          </h2>
        </AnimateOnScroll>

        <AnimateOnScroll delay={100}>
          <p className="mt-6 text-muted-foreground text-base lg:text-lg max-w-xl mx-auto leading-relaxed text-pretty">
            {t.finalCta.subtitle}
          </p>
        </AnimateOnScroll>

        <AnimateOnScroll delay={200}>
          <div className="mt-10 flex justify-center">
            <a
              href={quickstartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-10 py-4 text-base font-semibold text-primary-foreground hover:bg-accent-hover transition-all glow-accent"
              aria-label={t.finalCta.quickstart}
            >
              {t.finalCta.quickstart}
              <svg className="ml-2 w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
          </div>
        </AnimateOnScroll>
      </div>
    </section>
  )
}
