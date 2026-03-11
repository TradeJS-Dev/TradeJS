'use client';

import { useLocale } from './locale-provider';
import { AnimateOnScroll } from './animate-on-scroll';

export function HowItWorks() {
  const { t } = useLocale();

  return (
    <section id="how-it-works" className="relative py-24 lg:py-32">
      <div className="relative z-10 mx-auto max-w-6xl px-4 lg:px-8">
        <AnimateOnScroll>
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
              {t.howItWorks.sectionTitle}
            </h2>
            <p className="mt-4 text-muted-foreground text-base lg:text-lg max-w-2xl mx-auto text-pretty">
              {t.howItWorks.sectionSubtitle}
            </p>
          </div>
        </AnimateOnScroll>

        <div className="grid auto-rows-fr gap-8 md:grid-cols-2 lg:grid-cols-4">
          {t.howItWorks.steps.map((step, i) => (
            <AnimateOnScroll key={i} delay={i * 120} className="h-full">
              <div className="relative group h-full">
                <div className="relative h-full rounded-xl border border-border bg-surface/40 p-6 hover:border-primary/30 hover:bg-surface/70 transition-all duration-300">
                  {/* Step number */}
                  <div className="mb-4 text-3xl font-extrabold text-primary/20 font-mono">
                    {step.step}
                  </div>

                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {step.title}
                  </h3>

                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </div>
            </AnimateOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
