'use client';

import {
  BookMarked,
  BrainCircuit,
  DatabaseZap,
  Rocket,
} from 'lucide-react';
import { useLocale } from './locale-provider';
import { AnimateOnScroll } from './animate-on-scroll';

const roadmapIcons = [Rocket, BrainCircuit, BookMarked, DatabaseZap];

export function Roadmap() {
  const { t } = useLocale();

  return (
    <section id="roadmap" className="relative py-24 lg:py-32">
      <div className="absolute inset-0 grid-pattern-fine opacity-25" />
      <div
        className="absolute bottom-0 left-6 top-52 w-px bg-gradient-to-b from-primary/10 via-primary/35 to-transparent lg:left-1/2 lg:-translate-x-1/2"
        aria-hidden="true"
      />
      <div className="relative z-10 mx-auto max-w-7xl px-4 lg:px-8">
        <AnimateOnScroll>
          <div className="mb-14 text-center">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/8 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-primary/85">
              {t.roadmap.sectionTitle}
            </div>
            <h2 className="mt-5 text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
              {t.roadmap.sectionSubtitle}
            </h2>
          </div>
        </AnimateOnScroll>

        <div className="space-y-6 lg:space-y-0">
          {t.roadmap.items.map((item, index) => {
            const Icon = roadmapIcons[index] ?? Rocket;
            const isLeft = index % 2 === 0;

            return (
              <AnimateOnScroll
                key={item.quarter}
                delay={index * 120}
                className={`h-full ${index === 0 ? '' : 'lg:-mt-20'}`}
              >
                <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] lg:gap-8">
                  <div className="relative flex justify-center lg:col-start-2">
                    <div className="absolute top-5 h-3.5 w-3.5 rounded-full border border-primary/35 bg-background shadow-[0_0_0_6px_rgba(32,197,189,0.08)]" />
                    <div
                      className={`absolute top-[1.7rem] hidden h-px w-8 bg-gradient-to-r lg:block ${
                        isLeft
                          ? 'right-1/2 from-primary/10 to-primary/45'
                          : 'left-1/2 from-primary/45 to-primary/10'
                      }`}
                      aria-hidden="true"
                    />
                  </div>

                  <article
                    className={`group relative overflow-hidden rounded-2xl border border-border bg-surface/55 p-6 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/35 hover:bg-surface/80 ${
                      isLeft
                        ? 'lg:col-start-1 lg:row-start-1 lg:ml-auto lg:max-w-[30rem]'
                        : 'lg:col-start-3 lg:row-start-1 lg:mr-auto lg:max-w-[30rem]'
                    }`}
                  >
                    <div
                      className="absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent opacity-70"
                      aria-hidden="true"
                    />
                    <div className="flex items-start justify-between gap-4">
                      <div className="inline-flex rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                        {item.quarter}
                      </div>
                      <div className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary transition-colors group-hover:bg-primary/16">
                        <Icon size={18} />
                      </div>
                    </div>

                    <h3 className="mt-8 text-lg font-semibold text-foreground">
                      {item.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {item.description}
                    </p>

                    <div
                      className="mt-8 h-1.5 rounded-full bg-secondary/80"
                      aria-hidden="true"
                    >
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary/80 to-info/70"
                        style={{ width: `${55 + index * 12}%` }}
                      />
                    </div>
                  </article>
                </div>
              </AnimateOnScroll>
            );
          })}
        </div>
      </div>
    </section>
  );
}
