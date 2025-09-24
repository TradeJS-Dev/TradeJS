import puppeteer from 'puppeteer';
import { Interval } from '@types';

interface ScreenParams {
  symbol: string;
  interval: Interval;
}

export const screen = async ({ symbol, interval }: ScreenParams) => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH!,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--font-render-hinting=medium',
    ],
  });
  const page = await browser.newPage();
  await page.goto(
    `http://localhost:3000/routes/dashboard/${symbol}/${interval}`,
  );
};
