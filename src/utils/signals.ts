import 'dotenv/config';

import { Signal, TrendLine } from '@types';
import { getImageUrl } from '@utils/screenshot';
import { formatNumber } from '@utils/math';

const { APP_URL, TG_BOT_TOKEN: token, TG_CHAT_ID: chatId } = process.env;

export const formatMessage = (signal: Signal): string => {
  const {
    symbol,
    direction,
    currentPrice,
    takeProfitPrice,
    stopLossPrice,
    riskRatio,
    correlation,
    trend,
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

      lines.push(`Trend: ${trend}`);
      lines.push(`BTC correlation: ${correlation}`);

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

export const sendSignal = async (signal: Signal) => {
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

  const imageUrl = getImageUrl(signal);

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

  console.log('tg sendPhoto:', data?.ok ? 'sent' : JSON.stringify(data));
};

type Targets = {
  takeProfitPrice: number;
  stopLossPrice: number;
  riskRatio: number;
  qty: number;
};

interface TargetsOptions {
  TP_MAX_PERCENT: number;
  TP_MIN_PERCENT: number;
  TP_DISTANCE: number;
  SL_PERCENT: number;
  MAX_LOSS_VALUE: number;
  MIN_RISK_RATIO: number;
}

export const calcTargetsFromTrendLine = (
  trendLine: TrendLine,
  entryPrice: number,
  {
    TP_MIN_PERCENT,
    TP_MAX_PERCENT,
    SL_PERCENT,
    MAX_LOSS_VALUE,
    MIN_RISK_RATIO,
    TP_DISTANCE,
  }: TargetsOptions,
): Targets | null => {
  const { direction, points } = trendLine;
  const [start, end] = points;

  const basePrice = start.value;
  const breakPrice = end.value;

  const isLong = direction === 'LONG';

  if (isLong && entryPrice < breakPrice) {
    return null;
  }

  if (!isLong && entryPrice > breakPrice) {
    return null;
  }

  const rawTakeProfit = breakPrice + (basePrice - breakPrice) * TP_DISTANCE;

  const minTpMove = entryPrice * (TP_MIN_PERCENT / 100);
  const maxTpMove = entryPrice * (TP_MAX_PERCENT / 100);

  let tpDistance = isLong
    ? rawTakeProfit - entryPrice
    : entryPrice - rawTakeProfit;

  if (tpDistance <= 0) {
    tpDistance = minTpMove;
  }

  tpDistance = Math.max(minTpMove, Math.min(tpDistance, maxTpMove));

  const takeProfitPrice = isLong
    ? entryPrice + tpDistance
    : entryPrice - tpDistance;

  const stopLossPrice = isLong
    ? breakPrice * (1 - SL_PERCENT / 100)
    : breakPrice * (1 + SL_PERCENT / 100);

  let riskRatio: number;

  if (isLong) {
    const reward = takeProfitPrice - entryPrice;
    const risk = entryPrice - stopLossPrice;
    riskRatio = risk > 0 ? reward / risk : 0;
  } else {
    const reward = entryPrice - takeProfitPrice;
    const risk = stopLossPrice - entryPrice;
    riskRatio = risk > 0 ? reward / risk : 0;
  }

  if (riskRatio <= MIN_RISK_RATIO) {
    return null;
  }

  const qty = MAX_LOSS_VALUE / ((entryPrice * SL_PERCENT) / 100);

  return {
    qty,
    takeProfitPrice,
    stopLossPrice,
    riskRatio,
  };
};
