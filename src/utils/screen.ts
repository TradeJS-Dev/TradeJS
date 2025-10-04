import 'dotenv/config';
import puppeteer from 'puppeteer';
import { delay } from '@utils/async';
import { Signal } from '@types';

const APP_URL = process.env.APP_URL;
const token = process.env.TG_BOT_TOKEN;
const chatId = process.env.TG_CHAT_ID;

export const screenDashboard = async ({
  symbol,
  signalId,
  interval,
}: Signal) => {
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

  await page.goto(
    `${APP_URL}/routes/dashboard/${symbol}/${interval}/?signalId=${signalId}&autoZoom=true`,
  );

  await delay(30_000);

  await page.screenshot({
    path: `data/screenshots/${symbol}_${signalId}.png`,
  });

  await page.close();

  await browser.close();
};

export const sendSignal = async ({
  symbol,
  signalId,
  direction,
  interval,
}: Signal) => {
  const imageUrl = `${APP_URL}/api/files/screenshot/${symbol}/${signalId}`;

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: imageUrl,
      caption: `${direction} ${symbol}\ntimeframe: ${interval}m\nid: <code>${signalId}</code>`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Dashboard',
              url: `${APP_URL}/routes/dashboard/${symbol}/${interval}/?signalId=${signalId}`,
            },
          ],
        ],
      },
      parse_mode: 'HTML',
    }),
  });

  const data = await res.json();
};
