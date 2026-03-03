---
title: Настройка root пользователя
---

В CLI по умолчанию используется `--user root`, поэтому проще всего начать с корректно настроенного `root`-аккаунта.

## 1. Создать или обновить root

```bash
yarn user-add -u root -p 'StrongPassword123!'
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

1. Запустите приложение: `yarn dev`
2. Откройте: `http://localhost:3000/routes/signin`
3. Войдите под `root` и указанным паролем

Где лежит авторизация:

- `apps/app/src/app/auth.ts`

## 4. Смена пароля или токена

Смена пароля:

```bash
yarn user-add -u root -p 'NewStrongPassword456!'
```

Явно задать токен:

```bash
yarn user-add -u root -p 'NewStrongPassword456!' -t 'my-static-token'
```
