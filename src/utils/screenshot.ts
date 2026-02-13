import 'dotenv/config';

import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { delay } from '@utils/async';
import { Signal } from '@types';
import { getData, redisKeys } from '@utils/redis';

const { APP_URL } = process.env;

export const getScreenshotBase64 = async (signal: Signal) => {
  const screenshotPath = getScreenshotPath(signal);

  const fileBuffer = await fs.readFile(screenshotPath);
  const base64Image = fileBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64Image}`;

  return dataUrl;
};

export const getImageUrl = ({ symbol, signalId, interval }: Signal) =>
  `${APP_URL}/api/files/screenshot/${symbol}_${signalId}_${interval}`;

export const getScreenshotPath = ({ symbol, signalId, interval }: Signal) => {
  return path.join(
    process.cwd(),
    'data/screenshots',
    `${symbol}_${signalId}_${interval}.png`,
  ) as `${string}.png`;
};

export const screenDashboard = async (signal: Signal) => {
  const { symbol, signalId, interval } = signal;
  const rootUser = await getData(redisKeys.user('root'), null);
  const token =
    rootUser && typeof rootUser === 'object'
      ? (rootUser as Record<string, unknown>).token
      : null;
  const tokenParam =
    typeof token === 'string' && token.length > 0
      ? `&token=${encodeURIComponent(token)}`
      : '';

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH!,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--font-render-hinting=medium',
    ],
  });

  try {
    const page = await browser.newPage();

    try {
      await page.setViewport({
        width: 1400,
        height: 960,
        deviceScaleFactor: 2,
      });

      await page.goto(
        `${APP_URL}/routes/dashboard/bybit/${symbol}/${interval}/?signalId=${signalId}&autoZoom=true${tokenParam}`,
      );

      await delay(10_000);

      await page.screenshot({
        path: getScreenshotPath(signal),
      });
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
};
