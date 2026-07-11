import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { logger } from '@tradejs/infra/logger';
import {
  buildMarketKlineTopic,
  createMarketKlineSubscriber,
  MARKET_KLINE_CHANNEL,
  parseMarketKlineEvent,
} from './klineEvents';

const MAX_TOPICS_PER_CLIENT = 20;
const TOPIC_PATTERN =
  /^(bybit|binance|coinbase):(crypto|tradfi):[A-Z0-9._-]+:(1|3|5|15|30|60|120|240|360|720|D|W|M)$/;

type SubscriptionCommand = {
  op: 'subscribe' | 'unsubscribe';
  topics: string[];
};

export const parseSubscriptionCommand = (
  payload: string,
): SubscriptionCommand | null => {
  try {
    const value = JSON.parse(payload) as Partial<SubscriptionCommand>;
    if (
      (value.op !== 'subscribe' && value.op !== 'unsubscribe') ||
      !Array.isArray(value.topics)
    ) {
      return null;
    }
    const topics = [
      ...new Set(
        value.topics
          .map((topic) => String(topic).trim())
          .filter((topic) => TOPIC_PATTERN.test(topic)),
      ),
    ];
    return topics.length ? { op: value.op, topics } : null;
  } catch {
    return null;
  }
};

export const applySubscriptionCommand = (
  current: ReadonlySet<string>,
  command: SubscriptionCommand,
) => {
  const next = new Set(current);
  if (command.op === 'unsubscribe') {
    for (const topic of command.topics) next.delete(topic);
    return next;
  }
  for (const topic of command.topics) {
    if (next.size >= MAX_TOPICS_PER_CLIENT) break;
    next.add(topic);
  }
  return next;
};

export const startMarketWsGateway = async ({
  host = process.env.MARKET_WS_HOST || '0.0.0.0',
  port = Number(process.env.MARKET_WS_PORT || 3001),
}: {
  host?: string;
  port?: number;
} = {}) => {
  const subscriptions = new Map<WebSocket, Set<string>>();
  const alive = new WeakSet<WebSocket>();
  const server = http.createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    response.writeHead(404).end();
  });
  const wsServer = new WebSocketServer({ noServer: true });
  const subscriber = createMarketKlineSubscriber();

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws/market') {
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (client) => {
      wsServer.emit('connection', client, request);
    });
  });

  wsServer.on('connection', (client) => {
    subscriptions.set(client, new Set());
    alive.add(client);
    client.on('pong', () => alive.add(client));
    client.on('message', (raw) => {
      const command = parseSubscriptionCommand(raw.toString());
      if (!command) {
        client.send(JSON.stringify({ type: 'error', error: 'bad_command' }));
        return;
      }
      subscriptions.set(
        client,
        applySubscriptionCommand(
          subscriptions.get(client) ?? new Set(),
          command,
        ),
      );
      client.send(
        JSON.stringify({
          type: 'subscribed',
          topics: [...(subscriptions.get(client) ?? [])],
        }),
      );
    });
    client.on('close', () => subscriptions.delete(client));
  });

  const heartbeat = setInterval(() => {
    for (const client of subscriptions.keys()) {
      if (!alive.has(client)) {
        client.terminate();
        subscriptions.delete(client);
        continue;
      }
      alive.delete(client);
      client.ping();
    }
  }, 30_000);

  subscriber.on('message', (channel, payload) => {
    if (channel !== MARKET_KLINE_CHANNEL) return;
    const event = parseMarketKlineEvent(payload);
    if (!event) return;
    const topic = buildMarketKlineTopic(event);
    const message = JSON.stringify({ type: 'kline', topic, event });
    for (const [client, topics] of subscriptions) {
      if (client.readyState === WebSocket.OPEN && topics.has(topic)) {
        client.send(message);
      }
    }
  });
  await subscriber.subscribe(MARKET_KLINE_CHANNEL);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  logger.info('market websocket gateway listening on %s:%s', host, port);

  return {
    close: async () => {
      clearInterval(heartbeat);
      for (const client of subscriptions.keys()) client.close();
      subscriptions.clear();
      await subscriber.unsubscribe(MARKET_KLINE_CHANNEL);
      subscriber.disconnect();
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};
