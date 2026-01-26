import 'dotenv/config';

import { Signal, Interval } from '@types';
import { getImageUrl } from '@utils/screenshot';
import { formatNumber } from '@utils/math';
import { logger } from '@utils/logger';

const { APP_URL, TG_BOT_TOKEN: token, TG_CHAT_ID: chatId } = process.env;

export const formatMessage = (signal: Signal): string => {
  const {
    symbol,
    direction,
    strategy,
    prices: { currentPrice, takeProfitPrice, stopLossPrice, riskRatio },
    indicators: { distance, correlation, touches, atr },
  } = signal;

  try {
    const lines: string[] = [];

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
      lines.push('');

      lines.push(`Strategy: ${strategy}`);

      if (touches) {
        lines.push(`Points: ${touches}`);
      }

      if (atr) {
        lines.push(`ATR: ${atr}`);
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
          url: `${APP_URL}/routes/dashboard/${symbol}/${interval}/?signalId=${signalId}`,
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
