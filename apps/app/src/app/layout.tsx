import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { ClientOnly } from '@chakra-ui/react';
import { AppShell } from '@shared/AppShell';
import Provider from './provider';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'TradeJS App',
  description: 'Trading Strategies Framework',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ClientOnly>
          <Provider>
            <AppShell>{children}</AppShell>
          </Provider>
        </ClientOnly>
      </body>
    </html>
  );
}
