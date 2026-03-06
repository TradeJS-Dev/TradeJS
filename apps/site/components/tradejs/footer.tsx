"use client"

import { useLocale } from "./locale-provider"

export function Footer() {
  const { locale, t, toggleLocale } = useLocale()

  const docsUrl =
    locale === "ru"
      ? "https://docs.tradejs.dev/ru/"
      : "https://docs.tradejs.dev/"

  return (
    <footer className="border-t border-border bg-surface/30">
      <div className="mx-auto max-w-7xl px-4 py-12 lg:px-8">
        <div className="flex flex-col items-center gap-8 md:flex-row md:justify-between">
          {/* Logo + description */}
          <div className="flex flex-col items-center md:items-start gap-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary/10 border border-primary/20">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-primary">
                  <path d="M3 17L9 11L13 15L21 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M17 7H21V11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="text-foreground font-bold text-base tracking-tight">
                Trade<span className="text-primary">JS</span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs text-center md:text-left">
              {t.footer.description}
            </p>
          </div>

          {/* Links */}
          <div className="flex items-center gap-6">
            <a
              href="https://tradejs.dev"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.footer.app}
            </a>
            <a
              href={docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.footer.docs}
            </a>
            <button
              onClick={toggleLocale}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              aria-label={`Switch language to ${locale === "en" ? "Russian" : "English"}`}
            >
              <span className={locale === "en" ? "text-foreground" : ""}>EN</span>
              <span className="text-border">/</span>
              <span className={locale === "ru" ? "text-foreground" : ""}>RU</span>
            </button>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-border text-center">
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} TradeJS. {t.footer.rights}
          </p>
        </div>
      </div>
    </footer>
  )
}
