import 'dotenv/config';

import { Signal, Interval, SignalAnalysis } from '@types';
import { getImageUrl } from '@utils/screenshot';
import { formatNumber } from '@utils/math';
import { logger } from '@utils/logger';

const { APP_URL, TG_BOT_TOKEN: token, TG_CHAT_ID: chatId } = process.env;

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const normalizeQuality = (value?: number) =>
  typeof value === 'number'
    ? Math.max(1, Math.min(5, Math.round(value)))
    : null;

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

export const formatMessage = (
  signal: Signal,
  analysis?: Partial<SignalAnalysis> | null,
): string => {
  const {
    symbol,
    direction,
    strategy,
    orderStatus,
    configFromBacktest,
    ml,
    prices: { currentPrice, takeProfitPrice, stopLossPrice, riskRatio },
    indicators,
    additionalIndicators,
  } = signal;

  try {
    const lines: string[] = [];
    const distance =
      (additionalIndicators?.distance as number | undefined) ??
      (indicators.distance as number | undefined);
    const correlation = indicators.correlation as number | undefined;
    const touches =
      (additionalIndicators?.touches as number | undefined) ??
      (indicators.touches as number | undefined);
    const atrPctValue = indicators.atrPct;
    const atrPct = Array.isArray(atrPctValue)
      ? atrPctValue[atrPctValue.length - 1]
      : (atrPctValue as number | undefined);

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
        let orderStatusText = '⚪️ Order canceled';
        if (orderStatus === 'completed') {
          orderStatusText = '🟢 Order completed';
        } else if (orderStatus === 'failed') {
          orderStatusText = '🔴 Order failed';
        }
        lines.push(orderStatusText);
      }

      if (configFromBacktest) {
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
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: JSON.stringify(data),
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
