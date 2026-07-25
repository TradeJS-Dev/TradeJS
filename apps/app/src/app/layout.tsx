import type { Metadata } from 'next';
import Script from 'next/script';
import { AppShell } from '#shared/AppShell';
import { YANDEX_METRIKA_COUNTER_ID } from '#app/lib/yandexMetrika';
import Provider from './provider';
import './globals.css';

const fallbackMetadataBase = 'http://localhost:3000';

const metadataBase = (() => {
  const rawAppUrl = String(process.env.APP_URL || '').trim();

  if (!rawAppUrl) {
    return new URL(fallbackMetadataBase);
  }

  try {
    return new URL(rawAppUrl);
  } catch {
    return new URL(fallbackMetadataBase);
  }
})();

export const metadata: Metadata = {
  metadataBase,
  title: 'TradeJS App',
  description:
    'TradeJS app for dashboards, backtests, charts, derivatives, and runtime data.',
  applicationName: 'TradeJS App',
  openGraph: {
    title: 'TradeJS App',
    description:
      'TradeJS app for dashboards, backtests, charts, derivatives, and runtime data.',
    type: 'website',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'TradeJS App',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TradeJS App',
    description:
      'Dashboards, backtests, charts, derivatives, and runtime data in one UI.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const telemetryEnabled =
    process.env.NEXT_PUBLIC_TRADEJS_TELEMETRY_DISABLED !== '1';

  return (
    <html
      lang="en"
      className="dark"
      style={{ colorScheme: 'dark' }}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        {telemetryEnabled ? (
          <>
            <Script id="yandex-metrika" strategy="afterInteractive">
              {`
                (function(m,e,t,r,i,k,a){
                  m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
                  m[i].l=1*new Date();
                  for (var j = 0; j < document.scripts.length; j++) {
                    if (document.scripts[j].src === r) { return; }
                  }
                  k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a);
                })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_METRIKA_COUNTER_ID}', 'ym');

                ym(${YANDEX_METRIKA_COUNTER_ID}, 'init', {
                  clickmap: false,
                  ecommerce: false,
                  accurateTrackBounce: true,
                  trackLinks: false
                });
              `}
            </Script>
            <noscript>
              <div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://mc.yandex.ru/watch/${YANDEX_METRIKA_COUNTER_ID}`}
                  style={{ position: 'absolute', left: '-9999px' }}
                  alt=""
                />
              </div>
            </noscript>
          </>
        ) : null}
        <Provider>
          <AppShell>{children}</AppShell>
        </Provider>
      </body>
    </html>
  );
}
