import fs from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import { Signal } from '@tradejs/types';
import { delay } from '@tradejs/core/async';
import { logger } from '@tradejs/infra/logger';
import { createScreenshotSessionToken } from '@tradejs/infra/redis';
import { buildDashboardUrl } from './dashboardUrl';
import { getTradejsProjectCwd } from './tradejsConfig';

const { APP_URL } = process.env;
type ScreenshotRef = Pick<Signal, 'symbol' | 'signalId' | 'interval'>;
const SCREENSHOT_NAVIGATION_ATTEMPTS = 3;
const SCREENSHOT_NAVIGATION_RETRY_DELAY_MS = 2_000;
const SCREENSHOT_CAPTURE_ATTEMPTS = 2;
const SCREENSHOT_CAPTURE_RETRY_DELAY_MS = 2_000;
const SCREENSHOT_NAVIGATION_TIMEOUT_MS = 30_000;
const SCREENSHOT_READY_TIMEOUT_MS = 30_000;
const SCREENSHOT_READY_SELECTOR = '[data-screenshot-ready="true"]';
const SCREENSHOT_CONSOLE_LOG_LIMIT = 20;
const SCREENSHOT_CONSOLE_TEXT_LIMIT = 500;
const SCREENSHOT_BROWSER_STDERR = process.env.SCREENSHOT_BROWSER_STDERR === '1';
const PUPPETEER_DUMPIO = process.env.PUPPETEER_DUMPIO === '1';
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
  url.replace(/([?&]screenshotToken=)[^&]+/i, '$1<hidden>');

const getErrorFields = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  const fields: Array<[string, unknown]> = [
    ['name', record.name],
    ['code', record.code],
    ['errno', record.errno],
    ['type', record.type],
    ['syscall', record.syscall],
    ['hostname', record.hostname],
    ['host', record.host],
    ['address', record.address],
    ['port', record.port],
  ];

  return fields
    .filter(([, fieldValue]) => fieldValue != null && String(fieldValue).trim())
    .map(([key, fieldValue]) => `${key}=${String(fieldValue)}`);
};

const describeErrorValue = (value: unknown): string => {
  if (value == null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    const message = value.message?.trim() || '';
    const fields = getErrorFields(value);
    return [message, ...fields].filter(Boolean).join(' ');
  }

  if (typeof value === 'object') {
    const fields = getErrorFields(value);
    if (fields.length) {
      return fields.join(' ');
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
};

const getErrorMessage = (error: unknown) => {
  const maybeError = error as Error & { cause?: unknown };
  const message = describeErrorValue(error) || String(error);

  if (maybeError?.cause == null) {
    return message;
  }

  const cause = describeErrorValue(maybeError.cause);

  if (!cause) {
    return message;
  }

  return `${message}; cause: ${cause}`;
};

const truncateText = (
  value: string,
  maxLength = SCREENSHOT_CONSOLE_TEXT_LIMIT,
) => (value.length > maxLength ? `${value.slice(0, maxLength)}...` : value);

const shouldLogConsoleMessage = (type: string) =>
  ['error', 'warning', 'assert'].includes(type);

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

export const screenDashboard = async (
  signal: Signal,
  projectRoot?: string,
  userName = 'root',
) => {
  const { symbol, signalId, interval } = signal;
  const screenshotBaseUrl = getScreenshotRenderBaseUrl();
  const screenshotPath = getScreenshotPath(signal, projectRoot);
  const screenshotToken = await createScreenshotSessionToken(userName);
  if (!screenshotToken) {
    throw new Error(
      `Failed to create screenshot session token for ${userName}`,
    );
  }
  const dashboardUrl = buildDashboardUrl({
    baseUrl: screenshotBaseUrl,
    universe: signal.universe ?? 'crypto',
    symbol,
    interval,
    searchParams: {
      signalId,
      autoZoom: 'true',
      screenshot: '1',
      screenshotToken,
    },
  });
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
      dumpio: PUPPETEER_DUMPIO,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH!,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=medium',
      ],
    });
    const browserProcess = browser.process();
    let browserCloseRequested = false;

    try {
      if (browserProcess) {
        logger.info(
          'screenshot browser: %s %sm captureAttempt=%d pid=%s exec=%s',
          symbol,
          interval,
          captureAttempt,
          String(browserProcess.pid ?? 'unknown'),
          browserProcess.spawnfile || 'unknown',
        );
      }
      logger.info(
        'screenshot browser version: %s %sm captureAttempt=%d version=%s',
        symbol,
        interval,
        captureAttempt,
        await browser.version(),
      );
      browser.on('disconnected', () => {
        if (browserCloseRequested) {
          return;
        }

        logger.error(
          'screenshot browser disconnected: %s %sm captureAttempt=%d',
          symbol,
          interval,
          captureAttempt,
        );
      });
      if (SCREENSHOT_BROWSER_STDERR && browserProcess?.stderr) {
        browserProcess.stderr.on('data', (chunk: Buffer | string) => {
          const text = String(chunk).trim();
          if (!text) {
            return;
          }

          logger.error(
            'screenshot browser stderr: %s %sm captureAttempt=%d (%s)',
            symbol,
            interval,
            captureAttempt,
            truncateText(text),
          );
        });
      }

      const page = await browser.newPage();

      try {
        let consoleMessagesLogged = 0;

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
        page.on('close', () => {
          logger.info(
            'screenshot page closed: %s %sm captureAttempt=%d',
            symbol,
            interval,
            captureAttempt,
          );
        });
        page.on('console', (message) => {
          if (!shouldLogConsoleMessage(message.type())) {
            return;
          }

          if (consoleMessagesLogged >= SCREENSHOT_CONSOLE_LOG_LIMIT) {
            return;
          }

          consoleMessagesLogged += 1;
          const location = message.location();
          const suffix = location.url
            ? ` ${maskTokenInUrl(location.url)}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`
            : '';

          logger.error(
            'screenshot console %s: %s %sm captureAttempt=%d (%s%s)',
            message.type(),
            symbol,
            interval,
            captureAttempt,
            truncateText(message.text()),
            suffix,
          );
        });
        page.on('response', (response) => {
          const status = response.status();
          if (status < 400) {
            return;
          }

          const request = response.request();
          const resourceType = request.resourceType();
          if (
            !['document', 'script', 'stylesheet', 'fetch', 'xhr'].includes(
              resourceType,
            )
          ) {
            return;
          }

          logger.error(
            'screenshot response failed: %s %sm captureAttempt=%d status=%d type=%s url=%s',
            symbol,
            interval,
            captureAttempt,
            status,
            resourceType,
            maskTokenInUrl(response.url()),
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
            logger.info(
              'screenshot page info: %s %sm captureAttempt=%d title=%s ua=%s',
              symbol,
              interval,
              captureAttempt,
              truncateText(await page.title(), 120),
              truncateText(await page.evaluate(() => navigator.userAgent), 240),
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

        await page.waitForSelector(SCREENSHOT_READY_SELECTOR, {
          timeout: SCREENSHOT_READY_TIMEOUT_MS,
        });
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              );
            }),
        );
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
      browserCloseRequested = true;
      await browser.close().catch(() => undefined);
    }
  }

  throw captureError || new Error(`Failed screenshot: ${symbol} ${interval}`);
};
