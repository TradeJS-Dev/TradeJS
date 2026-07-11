import type { MarketKlineEvent } from '@tradejs/types';

type MarketKlineMessage = {
  type: 'kline';
  topic: string;
  event: MarketKlineEvent;
};

export const buildDashboardKlineTopic = ({
  provider,
  universe,
  symbol,
  interval,
}: Pick<MarketKlineEvent, 'provider' | 'universe' | 'symbol' | 'interval'>) =>
  [provider, universe, symbol.trim().toUpperCase(), interval].join(':');

export const parseMarketKlineMessage = (
  payload: string,
): MarketKlineMessage | null => {
  try {
    const message = JSON.parse(payload) as Partial<MarketKlineMessage>;
    if (
      message.type !== 'kline' ||
      typeof message.topic !== 'string' ||
      !message.event?.candle ||
      !Number.isFinite(message.event.candle.timestamp)
    ) {
      return null;
    }
    return message as MarketKlineMessage;
  } catch {
    return null;
  }
};

export const getMarketWebSocketUrl = (location: Location) => {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws/market`;
};

export const subscribeMarketKline = ({
  topic,
  onEvent,
  onReconnect,
}: {
  topic: string;
  onEvent: (event: MarketKlineEvent) => void;
  onReconnect: () => void;
}) => {
  let socket: WebSocket | null = null;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let openedOnce = false;

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(getMarketWebSocketUrl(window.location));
    socket.onopen = () => {
      reconnectAttempt = 0;
      socket?.send(JSON.stringify({ op: 'subscribe', topics: [topic] }));
      if (openedOnce) onReconnect();
      openedOnce = true;
    };
    socket.onmessage = ({ data }) => {
      const message = parseMarketKlineMessage(String(data));
      if (message?.topic === topic) onEvent(message.event);
    };
    socket.onclose = () => {
      if (stopped) return;
      const delayMs = Math.min(30_000, 1_000 * 2 ** reconnectAttempt);
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delayMs);
    };
    socket.onerror = () => socket?.close();
  };

  connect();
  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ op: 'unsubscribe', topics: [topic] }));
    }
    socket?.close();
  };
};
