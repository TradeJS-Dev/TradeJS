import React, { useEffect, useRef } from 'react';
import type { Props } from '@theme/Root';
import { useLocation } from '@docusaurus/router';

const YANDEX_METRIKA_ID = 107255958;
const YANDEX_METRIKA_SRC = `https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_METRIKA_ID}`;

type YmFn = {
  (...args: unknown[]): void;
  a?: unknown[][];
  l?: number;
};

declare global {
  interface Window {
    ym?: YmFn;
    __tradejsYmInit?: boolean;
  }
}

function ensureYandexMetrikaInit(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  if (window.__tradejsYmInit) {
    return;
  }

  const ym = (window.ym ??
    ((...args: unknown[]) => {
      const queue = window.ym?.a ?? [];
      queue.push(args);
      if (window.ym) {
        window.ym.a = queue;
      }
    })) as YmFn;

  window.ym = ym;
  window.ym.l = Date.now();

  const alreadyLoaded = Array.from(document.scripts).some(
    (script) => script.src === YANDEX_METRIKA_SRC,
  );

  if (!alreadyLoaded) {
    const script = document.createElement('script');
    script.async = true;
    script.src = YANDEX_METRIKA_SRC;
    const firstScript = document.getElementsByTagName('script')[0];
    if (firstScript?.parentNode) {
      firstScript.parentNode.insertBefore(script, firstScript);
    } else {
      document.head.appendChild(script);
    }
  }

  window.ym(YANDEX_METRIKA_ID, 'init', {
    ssr: true,
    clickmap: true,
    ecommerce: 'dataLayer',
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  });

  window.__tradejsYmInit = true;
}

export default function Root({ children }: Props): JSX.Element {
  const location = useLocation();
  const lastTrackedHrefRef = useRef<string | null>(null);
  const docsJsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'TradeJS Docs',
        url: 'https://docs.tradejs.dev',
        inLanguage: ['en-US', 'ru-RU'],
        about: 'Technical documentation for the TradeJS open-source framework',
        potentialAction: {
          '@type': 'SearchAction',
          target: 'https://docs.tradejs.dev/?q={search_term_string}',
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'CollectionPage',
        name: 'TradeJS Documentation',
        url: `https://docs.tradejs.dev${location.pathname}${location.search}${location.hash}`,
        isPartOf: {
          '@type': 'WebSite',
          name: 'TradeJS Docs',
          url: 'https://docs.tradejs.dev',
        },
        description:
          'Official docs for the TradeJS open-source framework: setup, APIs, strategy authoring, indicators, runtime execution, backtesting, AI/ML, and operations.',
      },
    ],
  };

  useEffect(() => {
    ensureYandexMetrikaInit();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return;
    }

    const currentHref = window.location.href;

    if (lastTrackedHrefRef.current == null) {
      lastTrackedHrefRef.current = currentHref;
      return;
    }

    if (lastTrackedHrefRef.current === currentHref) {
      return;
    }

    if (typeof window.ym === 'function') {
      window.ym(YANDEX_METRIKA_ID, 'hit', currentHref, {
        referrer: document.referrer,
      });
    }

    lastTrackedHrefRef.current = currentHref;
  }, [location.pathname, location.search, location.hash]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(docsJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      {children}
      <noscript>
        <div>
          <img
            src={`https://mc.yandex.ru/watch/${YANDEX_METRIKA_ID}`}
            style={{ position: 'absolute', left: '-9999px' }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
