import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Box, ClientOnly } from '@chakra-ui/react';
import { Sidebar } from '@shared/Sidebar';
import Provider from './provider';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Investing',
  description: 'madmoney',
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
            <Sidebar />
            <Box ml="60px">{children}</Box>
          </Provider>
        </ClientOnly>
      </body>
    </html>
  );
}
