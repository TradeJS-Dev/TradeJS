'use client';

import Image from 'next/image';
import { useLocale } from './locale-provider';
import { AnimateOnScroll } from './animate-on-scroll';
import { Brain, LayoutGrid, ExternalLink } from 'lucide-react';

const icons = [LayoutGrid, Brain];

export function Intelligence() {
  const { t } = useLocale();

  return (
    <section className="relative py-24 lg:py-32 overflow-hidden">
      {/* Background image with heavy overlay */}
      <div className="absolute inset-0">
        <Image
          src="/images/trader-bg.jpg"
          alt=""
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-background/92" />
      </div>

      {/* Accent glow */}
      <div
        className="absolute top-0 right-0 w-[500px] h-[500px] opacity-10"
        style={{
          background:
            'radial-gradient(circle at top right, rgba(76,169,255,0.3) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl px-4 lg:px-8">
        <AnimateOnScroll>
          <div className="text-center mb-16">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-info/20 bg-info/5 px-4 py-1.5 text-xs font-semibold text-info tracking-wider uppercase">
              02
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl text-balance">
              {t.intelligence.sectionTitle}
            </h2>
            <p className="mt-4 text-muted-foreground text-base lg:text-lg max-w-2xl mx-auto text-pretty">
              {t.intelligence.sectionSubtitle}
            </p>
          </div>
        </AnimateOnScroll>

        <div className="grid gap-6 md:grid-cols-2">
          {t.intelligence.items.map((item, i) => {
            const Icon = icons[i];
            return (
              <AnimateOnScroll key={i} delay={i * 120}>
                <div className="group relative h-full rounded-2xl border border-border bg-surface/40 backdrop-blur-md overflow-hidden hover:border-info/30 transition-all duration-300">
                  {/* Top accent stripe */}
                  <div className="h-1 bg-gradient-to-r from-info/60 via-primary/60 to-transparent" />
                  <div className="p-8">
                    <div className="mb-5 inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-info/10 text-info group-hover:bg-info/15 transition-colors">
                      <Icon size={26} />
                    </div>
                    <h3 className="text-xl font-semibold text-foreground mb-3">
                      {item.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-5">
                      {item.description}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {item.links.map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-info hover:text-primary transition-colors"
                        >
                          {link.label}
                          <ExternalLink size={12} />
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </AnimateOnScroll>
            );
          })}
        </div>
      </div>
    </section>
  );
}
