import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
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
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
