'use client';

import { useState, useEffect, useCallback } from 'react';
import { useLocale } from './locale-provider';
import { AnimateOnScroll } from './animate-on-scroll';
import { BarChart3, Radio, Brain, Send } from 'lucide-react';

const trustIcons = [BarChart3, Radio, Brain, Send];

export function Hero() {
  const { locale, t } = useLocale();
  const [wordIndex, setWordIndex] = useState(0);
  const [isFlipping, setIsFlipping] = useState(false);

  const words = t.hero.actionWords;

  const quickstartUrl =
    locale === 'ru'
      ? 'https://docs.tradejs.dev/ru/getting-started/local/'
      : 'https://docs.tradejs.dev/getting-started/local/';

  const cycleWord = useCallback(() => {
    setIsFlipping(true);
    setTimeout(() => {
      setWordIndex((prev) => (prev + 1) % words.length);
      setIsFlipping(false);
    }, 300);
  }, [words.length]);

  useEffect(() => {
    const interval = setInterval(cycleWord, 2500);
    return () => clearInterval(interval);
  }, [cycleWord]);

  const trustItems = [
    { label: t.hero.trust.backtesting, Icon: trustIcons[0] },
    { label: t.hero.trust.runtime, Icon: trustIcons[1] },
    { label: t.hero.trust.aiml, Icon: trustIcons[2] },
    { label: t.hero.trust.telegram, Icon: trustIcons[3] },
  ];

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src="/images/chart-bg.jpg"
          alt=""
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-background/85" />
      </div>

      {/* Grid overlay */}
      <div className="absolute inset-0 grid-pattern opacity-40" />

      {/* Subtle radial glow */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full opacity-20"
        style={{
          background:
            'radial-gradient(circle, rgba(32,197,189,0.2) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-5xl px-4 py-32 text-center lg:px-8 lg:py-40">
        <AnimateOnScroll delay={100}>
          <h1 className="text-5xl font-extrabold tracking-tight text-foreground sm:text-6xl lg:text-8xl leading-[1.05]">
            {/* Mechanical counter word */}
            <span
              className="inline-block relative h-[1.15em] overflow-hidden align-bottom"
              style={{ minWidth: '3.5ch' }}
            >
              <span
                className={`inline-block text-primary mechanical-flip ${isFlipping ? 'flipping-out' : 'flipping-in'}`}
              >
                {words[wordIndex]}
              </span>
            </span>
            <br />
            <span className="text-foreground">{t.hero.titleSuffix}</span>
          </h1>
        </AnimateOnScroll>

        <AnimateOnScroll delay={200}>
          <p className="mx-auto mt-8 max-w-2xl text-base text-muted-foreground leading-relaxed lg:text-lg text-pretty">
            {t.hero.subtitle}
          </p>
        </AnimateOnScroll>

        <AnimateOnScroll delay={300}>
          <div className="mt-10 flex justify-center">
            <a
              href={quickstartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-lg bg-primary px-10 py-4 text-base font-semibold text-primary-foreground hover:bg-accent-hover transition-all glow-accent"
              aria-label={t.hero.quickstart}
            >
              {t.hero.quickstart}
              <svg
                className="ml-2 w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </a>
          </div>
        </AnimateOnScroll>

        <AnimateOnScroll delay={400}>
          <div className="mt-16 flex flex-wrap items-center justify-center gap-6 lg:gap-10">
            {trustItems.map(({ label, Icon }) => (
              <div
                key={label}
                className="flex items-center gap-2 text-muted-foreground"
              >
                <Icon size={16} className="text-primary/70" />
                <span className="text-sm font-medium">{label}</span>
              </div>
            ))}
          </div>
        </AnimateOnScroll>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </section>
  );
}
