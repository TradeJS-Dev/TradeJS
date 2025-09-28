import 'dotenv/config';
import puppeteer from 'puppeteer';
import { delay } from '@utils/delay';
import { Interval } from '@types';

interface ScreenDashboardParams {
  symbol: string;
  interval: Interval;
}

const APP_URL = process.env.APP_URL;

export const screenDashboard = async ({
  symbol,
  interval,
}: ScreenDashboardParams) => {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH!,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--font-render-hinting=medium',
    ],
  });

  const page = await browser.newPage();

  await page.setViewport({
    width: 1400,
    height: 960,
    deviceScaleFactor: 2,
  });

  await page.goto(`${APP_URL}/routes/dashboard/${symbol}/${interval}`);

  await delay(15_000);

  await page.screenshot({
    path: `data/screenshots/${symbol}_${interval}.png`,
  });

  await page.close();

  await browser.close();
};
