import { Signal, Interval, SignalAnalysis } from '@tradejs/types';
import { formatNumber } from '@tradejs/core/math';
import { logger } from '@tradejs/infra/logger';
import { getImageUrl } from './screenshot';

const escapeHtml = (s?: string | null) => {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

const { APP_URL, TG_BOT_TOKEN: token, TG_CHAT_ID: chatId } = process.env;

const normalizeQuality = (value?: number) =>
  typeof value === 'number'
    ? Math.max(1, Math.min(5, Math.round(value)))
    : null;

const getLastNumber = (value: unknown): number | undefined => {
  if (Array.isArray(value)) {
    const last = value[value.length - 1];
    return typeof last === 'number' ? last : undefined;
  }

  return typeof value === 'number' ? value : undefined;
};

const getAiQualityLine = (analysis?: Partial<SignalAnalysis> | null) => {
  const quality = normalizeQuality(analysis?.quality);
  if (!quality) return null;

  const approvedCurrentDirection =
    analysis?.direction != null && analysis.direction !== null;

  if (quality >= 4 && approvedCurrentDirection) {
    return `🟢 AI Quality: ${quality}/5`;
  }

  if (quality === 3 && approvedCurrentDirection) {
    return `🟡 AI Quality: ${quality}/5`;
  }

  return `🔴 AI Quality: ${quality}/5`;
};

const getTelegramErrorReason = (data: unknown): string => {
  if (data && typeof data === 'object') {
    const record = data as {
      description?: unknown;
      error_code?: unknown;
    };
    const description =
      typeof record.description === 'string' ? record.description : '';
    const errorCode =
      typeof record.error_code === 'number' ? record.error_code : undefined;

    if (description && errorCode != null) {
      return `${errorCode}: ${description}`;
    }

    if (description) {
      return description;
    }
  }

  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
};

export const formatMessage = (
  signal: Signal,
  analysis?: Partial<SignalAnalysis> | null,
): string => {
  const {
    symbol,
    direction,
    strategy,
    orderStatus,
    orderSkipReason,
    isConfigFromBacktest,
    ml,
    prices: { currentPrice, takeProfitPrice, stopLossPrice, riskRatio },
    indicators,
    additionalIndicators,
  } = signal;

  try {
    const lines: string[] = [];
    const distance = additionalIndicators?.distance as number | undefined;
    const touches = additionalIndicators?.touches as number | undefined;
    const correlation = getLastNumber(indicators.correlation);
    const atrPct = getLastNumber(indicators.atrPct);
    const spread = getLastNumber(indicators.spread);

    const formatPrices = () => {
      const tpPercent =
        Math.abs(
          ((takeProfitPrice - currentPrice) / currentPrice) * 100,
        ).toFixed(2) + '%';

      const slPercent =
        Math.abs(((stopLossPrice - currentPrice) / currentPrice) * 100).toFixed(
          2,
        ) + '%';

      const prices = [
        `Price: <b>${formatNumber(currentPrice)}</b>`,
        `TP: <b>${formatNumber(takeProfitPrice)}</b> (${tpPercent})`,
        `SL: <b>${formatNumber(stopLossPrice)}</b> (${slPercent})`,
        `R:R = <b>${riskRatio.toFixed(2)}</b>`,
      ]
        .filter(Boolean)
        .join('\n');

      return prices;
    };

    const checkAnalys = () => {
      const emojiDir =
        direction === 'LONG'
          ? '🟩 LONG'
          : direction === 'SHORT'
            ? '🟥 SHORT'
            : '⬜️ NO TRADE';

      lines.push(`<b>${emojiDir} ${symbol}</b>`);
      lines.push(`Strategy: ${strategy}`);

      lines.push('');

      if (orderStatus) {
        let orderStatusText = '⚪️ Order skipped';
        if (orderStatus === 'completed') {
          orderStatusText = '🟢 Order completed';
        } else if (orderStatus === 'failed') {
          orderStatusText = '🔴 Order failed';
        } else if (orderStatus === 'canceled') {
          // Legacy value for historical signals.
          orderStatusText = '⚪️ Order skipped';
        }
        lines.push(orderStatusText);
        if (
          (orderStatus === 'skipped' || orderStatus === 'canceled') &&
          orderSkipReason
        ) {
          lines.push(`Skip reason: <b>${escapeHtml(orderSkipReason)}</b>`);
        }
      }

      if (isConfigFromBacktest) {
        lines.push('🟢 Using config from backtest');
      } else {
        lines.push('🟡 Using base config');
      }

      if (ml) {
        lines.push(
          `${ml.passed ? '🟢 ML: PASS' : '🔴 ML: FAIL'} (${ml.probability.toFixed(3)} / ${ml.threshold.toFixed(2)})`,
        );
      }

      const aiQualityLine = getAiQualityLine(analysis);
      if (aiQualityLine) {
        lines.push(aiQualityLine);
      }

      lines.push('');

      if (touches) {
        lines.push(`Points: ${touches}`);
      }

      if (atrPct != null && Number.isFinite(atrPct)) {
        lines.push(`ATR: ${atrPct.toFixed(2)}`);
      }

      if (distance) {
        lines.push(`Distance: ${distance}`);
      }

      if (correlation) {
        lines.push(`BTC correlation: ${correlation}`);
      }

      if (spread != null && Number.isFinite(spread)) {
        lines.push(`BTC spread (CB-BN)/BN: ${spread.toFixed(6)}`);
      }

      const prices = formatPrices();

      if (prices) {
        lines.push('');
        lines.push(prices);
      }
    };

    checkAnalys();

    return lines.join('\n').trim();
  } catch (err) {
    return `<b>⚠️ Ошибка форматирования сообщения для ${symbol}</b>\nДетали: ${(err as Error).message || String(err)}`;
  }
};

export const sendSignal = async (
  signal: Signal,
  imgInterval: Interval,
  analysis?: Partial<SignalAnalysis> | null,
) => {
  const { symbol, signalId, interval } = signal;

  const message = formatMessage(signal, analysis);

  const markup = {
    inline_keyboard: [
      [
        {
          text: 'Dashboard',
          url: `${APP_URL}/routes/dashboard/bybit/${symbol}/${interval}/?signalId=${signalId}`,
        },
      ],
    ],
  };

  if (!APP_URL?.startsWith('https')) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    return;
  }

  const imageUrl = getImageUrl({ ...signal, interval: imgInterval });

  const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: imageUrl,
      caption: message,
      reply_markup: markup,
      parse_mode: 'HTML',
    }),
  });

  const data = await res.json();

  if (!data?.ok) {
    const reason = getTelegramErrorReason(data);
    logger.error('tg sendPhoto failed: %s', JSON.stringify(data));
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `${message}\n\n⚠️ <b>Photo delivery failed</b>\nReason: <code>${escapeHtml(reason)}</code>`,
        reply_markup: markup,
        parse_mode: 'HTML',
      }),
    });
  }

  logger.info('tg sendPhoto: %s', data?.ok ? 'sent' : JSON.stringify(data));
};

export const formatAnalysisMessage = (
  signal: Signal,
  analysis: Partial<SignalAnalysis>,
): string => {
  const lines: string[] = [];
  const blocks: string[] = [];
  const quality = normalizeQuality(analysis.quality);

  lines.push(`<b>AI analysis ${signal.symbol}</b>`);
  lines.push(`Signal direction: <b>${signal.direction}</b>`);
  lines.push(`AI direction: <b>${analysis.direction ?? 'NO TRADE'}</b>`);

  if (quality) {
    lines.push(`Quality: <b>${quality}/5</b>`);
  }

  if (typeof analysis.needRetest === 'boolean') {
    lines.push(`Need retest: <b>${analysis.needRetest ? 'YES' : 'NO'}</b>`);
  }

  if (typeof analysis.retestPrice === 'number') {
    lines.push(`Retest price: <b>${formatNumber(analysis.retestPrice)}</b>`);
  }

  if (typeof analysis.takeProfitPrice === 'number') {
    lines.push(`AI TP: <b>${formatNumber(analysis.takeProfitPrice)}</b>`);
  }

  if (typeof analysis.stopLossPrice === 'number') {
    lines.push(`AI SL: <b>${formatNumber(analysis.stopLossPrice)}</b>`);
  }

  const pushBlock = (title: string, value?: string) => {
    if (!value) return;
    const clean = value.trim();
    if (!clean) return;
    blocks.push(`<b>${title}:</b>\n${escapeHtml(clean)}`);
  };

  pushBlock('Setup', analysis.setup);
  pushBlock('Confirmations', analysis.confirmations);
  pushBlock('BTC', analysis.btcContext);
  pushBlock('Retest', analysis.retestPlan);
  pushBlock('Risk/Levels', analysis.riskLevels);
  pushBlock('Why Quality', analysis.qualityReason);
  pushBlock('Trigger/Invalidation', analysis.triggerInvalidation);

  if (blocks.length > 0) {
    lines.push('');
    lines.push(blocks.join('\n\n'));
  }

  return lines.join('\n');
};

export const sendSignalAnalysis = async (
  signal: Signal,
  analysis: Partial<SignalAnalysis>,
) => {
  const message = formatAnalysisMessage(signal, analysis);

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
    }),
  });

  const data = await res.json();
  logger.info(
    'tg sendMessage (analysis): %s',
    data?.ok ? 'sent' : JSON.stringify(data),
  );
};
