'use client';

import { useState, useEffect } from 'react';
import { useLocale } from './locale-provider';
import { Menu, X } from 'lucide-react';

export function Header() {
  const { locale, t, toggleLocale } = useLocale();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const quickstartUrl =
    locale === 'ru'
      ? 'https://docs.tradejs.dev/ru/getting-started/quickstart/'
      : 'https://docs.tradejs.dev/getting-started/quickstart/';

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: t.nav.advantages, href: '#advantages' },
    { label: t.nav.howItWorks, href: '#how-it-works' },
    { label: t.nav.devExperience, href: '#dev-experience' },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-background/90 backdrop-blur-xl border-b border-border'
          : 'bg-transparent'
      }`}
    >
      <div className="mx-auto max-w-7xl flex items-center justify-between px-4 py-3 lg:px-8">
        {/* Logo */}
        <a
          href="#"
          className="flex items-center gap-2 group"
          aria-label="TradeJS Home"
        >
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 group-hover:bg-primary/20 transition-colors">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              className="text-primary"
            >
              <path
                d="M3 17L9 11L13 15L21 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M17 7H21V11"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-foreground font-bold text-lg tracking-tight">
            Trade<span className="text-primary">JS</span>
          </span>
        </a>

        {/* Desktop nav */}
        <nav
          className="hidden md:flex items-center gap-6"
          aria-label="Main navigation"
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Right side */}
        <div className="hidden md:flex items-center gap-3">
          <button
            onClick={toggleLocale}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
            aria-label={`Switch language to ${locale === 'en' ? 'Russian' : 'English'}`}
          >
            <span
              className={
                locale === 'en' ? 'text-foreground' : 'text-muted-foreground'
              }
            >
              EN
            </span>
            <span className="text-border">|</span>
            <span
              className={
                locale === 'ru' ? 'text-foreground' : 'text-muted-foreground'
              }
            >
              RU
            </span>
          </button>
          <a
            href={quickstartUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-accent-hover transition-colors glow-accent"
          >
            {t.nav.quickstart}
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-foreground p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-background/95 backdrop-blur-xl border-b border-border">
          <nav
            className="flex flex-col px-4 py-4 gap-3"
            aria-label="Mobile navigation"
          >
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="text-muted-foreground hover:text-foreground text-sm font-medium py-2 transition-colors"
              >
                {link.label}
              </a>
            ))}
            <hr className="border-border" />
            <div className="flex items-center gap-3 py-2">
              <button
                onClick={toggleLocale}
                className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                aria-label={`Switch language to ${locale === 'en' ? 'Russian' : 'English'}`}
              >
                <span
                  className={
                    locale === 'en'
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  }
                >
                  EN
                </span>
                <span className="text-border">|</span>
                <span
                  className={
                    locale === 'ru'
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  }
                >
                  RU
                </span>
              </button>
            </div>
            <a
              href={quickstartUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground text-center hover:bg-accent-hover transition-colors"
            >
              {t.nav.quickstart}
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
