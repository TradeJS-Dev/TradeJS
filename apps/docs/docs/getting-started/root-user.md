---
title: Root User Setup
---

TradeJS CLI defaults to `--user root`, so creating a valid `root` account is the fastest way to start.

## 1. Create or Update Root User

```bash
yarn user-add -u root -p 'StrongPassword123!'
```

What this does:

- hashes password with `bcrypt`
- writes user record to Redis key `users:index:root`
- creates a persistent token automatically for `root` if it is missing

## 2. Check User in Redis

```bash
redis-cli JSON.GET users:index:root
```

You should see at least:

- `userName`
- `passwordHash`
- `updatedAt`
- `token` (for `root`)

## 3. Sign In to the App

1. Start app: `yarn dev`
2. Open: `http://localhost:3000/routes/signin`
3. Log in with `root` and your password

Credential auth path:

- `apps/app/src/app/auth.ts`

## 4. Rotate Password or Token

Set new password:

```bash
yarn user-add -u root -p 'NewStrongPassword456!'
```

Set explicit token:

```bash
yarn user-add -u root -p 'NewStrongPassword456!' -t 'my-static-token'
```
