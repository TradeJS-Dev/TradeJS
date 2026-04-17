import type { Metadata } from 'next';
import { AppShell } from '@shared/AppShell';
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
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Provider>
          <AppShell>{children}</AppShell>
        </Provider>
      </body>
    </html>
  );
}
