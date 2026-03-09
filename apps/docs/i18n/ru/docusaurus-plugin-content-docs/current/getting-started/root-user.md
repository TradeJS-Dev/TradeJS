---
title: Настройка root пользователя
---

В CLI по умолчанию используется `--user root`, поэтому проще всего начать с корректно настроенного `root`-аккаунта.

## 1. Создать или обновить root

```bash
npx @tradejs/cli user-add -u root -p 'StrongPassword123!'
```

Что делает команда:

- хеширует пароль через `bcrypt`
- записывает пользователя в Redis-ключ `users:index:root`
- автоматически создает persistent token для `root`, если его нет

## 2. Проверить пользователя в Redis

```bash
redis-cli JSON.GET users:index:root
```

В ответе должны быть как минимум:

- `userName`
- `passwordHash`
- `updatedAt`
- `token` (для `root`)

## 3. Войти в приложение

1. Откройте страницу входа вашего TradeJS-приложения (или API-клиент).
2. Войдите под `root` и указанным паролем.
3. Для API-only сценариев используйте persistent token из Redis.

## 4. Смена пароля или токена

Смена пароля:

```bash
npx @tradejs/cli user-add -u root -p 'NewStrongPassword456!'
```

Явно задать токен:

```bash
npx @tradejs/cli user-add -u root -p 'NewStrongPassword456!' -t 'my-static-token'
```
