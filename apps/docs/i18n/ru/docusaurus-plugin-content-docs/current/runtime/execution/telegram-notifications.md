---
title: Telegram-уведомления
---

TradeJS умеет отправлять сигналы в Telegram через `npx @tradejs/cli signals --notify`.

## 1. Настройте переменные Telegram

В `@tradejs/node` / `@tradejs/cli` читаются:

- `TG_BOT_TOKEN`
- `TG_CHAT_ID`
- `APP_URL`

Пример `.env.local`:

```bash
TG_BOT_TOKEN=123456789:AA...
TG_CHAT_ID=-1001234567890
APP_URL=https://your-tradejs-host
```

Важные моменты:

- Если `APP_URL` на HTTPS, TradeJS отправит скриншот графика + подпись.
- Если `APP_URL` не HTTPS, отправится только текст.

## 2. Быстрая проверка бота

```bash
curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"${TG_CHAT_ID}\",\"text\":\"TradeJS test message\"}"
```

## 3. Запуск уведомлений из signals

```bash
npx @tradejs/cli signals --user root --notify --tickers BTC --cacheOnly
```

Поток:

1. Скрипт находит сигналы.
2. Скрипт пытается прочитать AI-анализ из Redis `analysis:<symbol>:<signalId>`.
3. TradeJS отправляет основное сообщение по сигналу.
4. Если AI-анализ есть, отправляется второе сообщение с анализом.

## 4. Частые проблемы

- Сообщения не приходят:
  проверьте `TG_BOT_TOKEN`, `TG_CHAT_ID`, и что бот добавлен в чат/канал.
- Приходит текст, но без картинки:
  проверьте `APP_URL` и доступность HTTPS снаружи.
- Нет второго сообщения с AI:
  проверьте наличие ключа `analysis:<symbol>:<signalId>` в Redis.
