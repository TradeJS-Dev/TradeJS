import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { Signal } from '@tradejs/types';
import { delay } from '@tradejs/core/async';
import { logger } from '@tradejs/infra/logger';
import { getData, redisKeys } from '@tradejs/infra/redis';
import { getTradejsProjectCwd } from './tradejsConfig';

const { APP_URL } = process.env;
type ScreenshotRef = Pick<Signal, 'symbol' | 'signalId' | 'interval'>;
const SCREENSHOT_NAVIGATION_ATTEMPTS = 3;
const SCREENSHOT_NAVIGATION_RETRY_DELAY_MS = 2_000;
const SCREENSHOT_CAPTURE_ATTEMPTS = 2;
const SCREENSHOT_CAPTURE_RETRY_DELAY_MS = 2_000;
const SCREENSHOT_NAVIGATION_TIMEOUT_MS = 30_000;
const SCREENSHOT_RENDER_DELAY_MS = 10_000;
const SCREENSHOT_VIEWPORT = {
  width: 1280,
  height: 800,
  deviceScaleFactor: process.env.NODE_ENV === 'production' ? 1 : 2,
};

const getProjectRoot = (projectRoot?: string): string =>
  path.resolve(getTradejsProjectCwd(projectRoot));

const getScreenshotsDir = (projectRoot?: string): string =>
  path.join(getProjectRoot(projectRoot), 'data', 'screenshots');

const maskTokenInUrl = (url: string) =>
  url.replace(/([?&]token=)[^&]+/i, '$1<hidden>');

const getErrorMessage = (error: unknown) => {
  const maybeError = error as Error & { cause?: unknown };
  const message = maybeError?.message || String(error);

  if (maybeError?.cause == null) {
    return message;
  }

  const cause =
    maybeError.cause instanceof Error
      ? maybeError.cause.message
      : String(maybeError.cause);

  return `${message}; cause: ${cause}`;
};

export const getScreenshotBase64 = async (
  signal: Signal,
  projectRoot?: string,
) => {
  const fileBuffer = await getScreenshotBuffer(signal, projectRoot);
  const base64Image = fileBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64Image}`;

  return dataUrl;
};

export const getScreenshotBuffer = async (
  signal: Signal,
  projectRoot?: string,
) => {
  const screenshotPath = getScreenshotPath(signal, projectRoot);

  return fs.readFile(screenshotPath);
};

export const getScreenshotFilename = ({
  symbol,
  signalId,
  interval,
}: ScreenshotRef) => `${symbol}_${signalId}_${interval}.png`;

export const getImageUrl = ({ symbol, signalId, interval }: Signal) =>
  `${APP_URL}/api/files/screenshot/${symbol}_${signalId}_${interval}.png`;

const getScreenshotRenderBaseUrl = () => {
  const fallback = String(APP_URL || '').trim();
  if (fallback) {
    return fallback;
  }

  throw new Error('APP_URL is required for screenshots');
};

export const getScreenshotPath = (
  { symbol, signalId, interval }: ScreenshotRef,
  projectRoot?: string,
) => {
  return path.join(
    getScreenshotsDir(projectRoot),
    getScreenshotFilename({ symbol, signalId, interval }),
  ) as `${string}.png`;
};

export const screenDashboard = async (signal: Signal, projectRoot?: string) => {
  const { symbol, signalId, interval } = signal;
  const screenshotBaseUrl = getScreenshotRenderBaseUrl();
  const screenshotPath = getScreenshotPath(signal, projectRoot);
  const rootUser = await getData(redisKeys.user('root'), null);
  const token =
    rootUser && typeof rootUser === 'object'
      ? (rootUser as Record<string, unknown>).token
      : null;
  const tokenParam =
    typeof token === 'string' && token.length > 0
      ? `&token=${encodeURIComponent(token)}`
      : '';
  const dashboardUrl = `${screenshotBaseUrl}/routes/dashboard/bybit/${symbol}/${interval}/?signalId=${signalId}&autoZoom=true&screenshot=1${tokenParam}`;
  const maskedDashboardUrl = maskTokenInUrl(dashboardUrl);

  logger.info(
    'screenshot start: %s %sm url=%s path=%s',
    symbol,
    interval,
    maskedDashboardUrl,
    screenshotPath,
  );

  let captureError: Error | null = null;

  for (
    let captureAttempt = 1;
    captureAttempt <= SCREENSHOT_CAPTURE_ATTEMPTS;
    captureAttempt += 1
  ) {
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
        page.on('requestfailed', (request) => {
          if (
            !request.isNavigationRequest() &&
            request.resourceType() !== 'document'
          ) {
            return;
          }

          logger.error(
            'screenshot request failed: %s %sm %s (%s)',
            symbol,
            interval,
            maskTokenInUrl(request.url()),
            request.failure()?.errorText || 'unknown',
          );
        });
        page.on('pageerror', (error) => {
          logger.error(
            'screenshot page error: %s %sm (%s)',
            symbol,
            interval,
            error.message || String(error),
          );
        });
        page.on('error', (error) => {
          logger.error(
            'screenshot target error: %s %sm (%s)',
            symbol,
            interval,
            error.message || String(error),
          );
        });

        await page.setViewport(SCREENSHOT_VIEWPORT);

        let gotoError: Error | null = null;

        logger.info(
          'screenshot render: %s %sm captureAttempt=%d viewport=%dx%d@%d',
          symbol,
          interval,
          captureAttempt,
          SCREENSHOT_VIEWPORT.width,
          SCREENSHOT_VIEWPORT.height,
          SCREENSHOT_VIEWPORT.deviceScaleFactor,
        );

        for (
          let attempt = 1;
          attempt <= SCREENSHOT_NAVIGATION_ATTEMPTS;
          attempt += 1
        ) {
          try {
            logger.info(
              'screenshot goto: %s %sm captureAttempt=%d attempt=%d url=%s',
              symbol,
              interval,
              captureAttempt,
              attempt,
              maskedDashboardUrl,
            );
            const response = await page.goto(dashboardUrl, {
              waitUntil: 'domcontentloaded',
              timeout: SCREENSHOT_NAVIGATION_TIMEOUT_MS,
            });
            logger.info(
              'screenshot goto ok: %s %sm captureAttempt=%d attempt=%d status=%s finalUrl=%s',
              symbol,
              interval,
              captureAttempt,
              attempt,
              response ? String(response.status()) : 'null',
              maskTokenInUrl(page.url()),
            );
            gotoError = null;
            break;
          } catch (error) {
            gotoError = error as Error;
            logger.error(
              'screenshot goto failed: %s %sm captureAttempt=%d attempt=%d url=%s (%s)',
              symbol,
              interval,
              captureAttempt,
              attempt,
              maskedDashboardUrl,
              gotoError.message || String(gotoError),
            );
            if (attempt >= SCREENSHOT_NAVIGATION_ATTEMPTS) {
              break;
            }
            await delay(SCREENSHOT_NAVIGATION_RETRY_DELAY_MS);
          }
        }

        if (gotoError) {
          throw new Error(
            `Failed to open dashboard ${dashboardUrl}: ${gotoError.message || String(gotoError)}`,
          );
        }

        await delay(SCREENSHOT_RENDER_DELAY_MS);
        await fs.mkdir(getScreenshotsDir(projectRoot), { recursive: true });
        await page.screenshot({
          path: screenshotPath,
          type: 'png',
        });
        logger.info(
          'screenshot saved: %s %sm path=%s',
          symbol,
          interval,
          screenshotPath,
        );
        return;
      } finally {
        await page.close().catch(() => undefined);
      }
    } catch (error) {
      captureError = error as Error;
      logger.error(
        'screenshot capture failed: %s %sm captureAttempt=%d (%s)',
        symbol,
        interval,
        captureAttempt,
        getErrorMessage(captureError),
      );
      if (captureAttempt < SCREENSHOT_CAPTURE_ATTEMPTS) {
        await delay(SCREENSHOT_CAPTURE_RETRY_DELAY_MS);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  throw captureError || new Error(`Failed screenshot: ${symbol} ${interval}`);
};
