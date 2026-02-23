import 'dotenv/config';

import { Signal, Interval, SignalAnalysis } from '@types';
import { getImageUrl } from '@utils/screenshot';
import { formatNumber } from '@utils/math';
import { logger } from '@utils/logger';

const { APP_URL, TG_BOT_TOKEN: token, TG_CHAT_ID: chatId } = process.env;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const formatMessage = (signal: Signal): string => {
  const {
    symbol,
    direction,
    strategy,
    orderStatus,
    configFromBacktest,
    ml,
    prices: { currentPrice, takeProfitPrice, stopLossPrice, riskRatio },
    indicators,
  } = signal;

  try {
    const lines: string[] = [];
    const distance = indicators.distance as number | undefined;
    const correlation = indicators.correlation as number | undefined;
    const touches = indicators.touches as number | undefined;
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

export const sendSignal = async (signal: Signal, imgInterval: Interval) => {
  const { symbol, signalId, interval } = signal;

  const message = formatMessage(signal);

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
  const quality =
    typeof analysis.quality === 'number'
      ? Math.max(1, Math.min(5, Math.round(analysis.quality)))
      : null;

  lines.push(`<b>AI analysis ${signal.symbol}</b>`);
  lines.push(`Signal direction: <b>${signal.direction}</b>`);
  lines.push(`AI direction: <b>${analysis.direction ?? 'NO TRADE'}</b>`);

  if (quality) {
    lines.push(`Quality: <b>${quality}/5</b>`);
  }

  if (typeof analysis.takeProfitPrice === 'number') {
    lines.push(`AI TP: <b>${formatNumber(analysis.takeProfitPrice)}</b>`);
  }

  if (typeof analysis.stopLossPrice === 'number') {
    lines.push(`AI SL: <b>${formatNumber(analysis.stopLossPrice)}</b>`);
  }

  if (analysis.comment) {
    lines.push('');
    lines.push(escapeHtml(analysis.comment));
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
