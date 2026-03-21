---
title: Telegram Notifications
---

TradeJS can send signal messages to Telegram from `npx @tradejs/cli signals --notify`.

## 1. Configure Telegram Variables

`@tradejs/node` / `@tradejs/cli` read:

- `TG_BOT_TOKEN`
- `TG_CHAT_ID`
- `APP_URL`

Example `.env.local`:

```bash
TG_BOT_TOKEN=123456789:AA...
TG_CHAT_ID=-1001234567890
APP_URL=https://your-tradejs-host
```

Notes:

- TradeJS uploads the rendered screenshot to Telegram with the signal caption.
- If `APP_URL` is a public HTTPS URL, the Telegram message also includes a dashboard button.
- If screenshot rendering fails or the PNG is missing, TradeJS falls back to a text message instead of dropping the notification.

## 2. Quick Bot Check

```bash
curl -s -X POST "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\":\"${TG_CHAT_ID}\",\"text\":\"TradeJS test message\"}"
```

## 3. Send Notifications from Signals

```bash
npx @tradejs/cli signals --user root --notify --tickers BTC --cacheOnly
```

Flow:

1. Script finds signals.
2. Script loads AI analysis from Redis key `analysis:<symbol>:<signalId>` if present.
3. TradeJS sends the main signal message and uploads the screenshot when available.
4. If AI analysis exists, TradeJS sends one follow-up analysis message.

## 4. Common Troubleshooting

- No messages at all:
  check `TG_BOT_TOKEN`, `TG_CHAT_ID`, and whether bot is added to chat/channel.
- Message without image:
  check screenshot generation and whether the app can render the dashboard page configured by `APP_URL`.
- Missing AI follow-up:
  check that `analysis:<symbol>:<signalId>` exists in Redis.
