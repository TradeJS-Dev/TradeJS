# syntax=docker/dockerfile:1

FROM node:24-alpine AS dependencies

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_CHROME_SKIP_DOWNLOAD=true

RUN apk add --no-cache git

RUN corepack enable && corepack prepare yarn@4.13.0 --activate

# Keep dependency installation independent from application source changes.
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/app/package.json ./apps/app/package.json
COPY packages/base/package.json ./packages/base/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/connectors/package.json ./packages/connectors/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/create-tradejs/package.json ./packages/create-tradejs/package.json
COPY packages/indicators/package.json ./packages/indicators/package.json
COPY packages/infra/package.json ./packages/infra/package.json
COPY packages/ml/package.json ./packages/ml/package.json
COPY packages/node/package.json ./packages/node/package.json
COPY packages/strategies/package.json ./packages/strategies/package.json
COPY packages/types/package.json ./packages/types/package.json

RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn install --immutable

FROM dependencies AS production-dependencies

RUN --mount=type=cache,target=/root/.yarn/berry/cache \
    yarn workspaces focus --all --production

FROM dependencies AS builder

COPY apps ./apps
COPY packages ./packages
COPY proto ./proto
COPY bin ./bin
COPY turbo.json tsconfig.json tsconfig.base.json tsconfig.packages.json tradejs.config.ts ./

RUN --mount=type=cache,target=/app/.turbo \
    --mount=type=cache,target=/app/apps/app/.next/cache \
    yarn turbo run build --filter=@tradejs/cli... --filter=@tradejs/app...

# Runtime dependency trees come from the production-only stage below.
RUN rm -rf apps/app/node_modules packages/cli/node_modules

FROM node:24-alpine AS runner

ARG TRADEJS_GIT_SHA=unknown

RUN corepack enable && corepack prepare yarn@4.13.0 --activate

LABEL org.opencontainers.image.source="https://github.com/TradeJS-Dev/TradeJS" \
      org.opencontainers.image.description="TradeJS app" \
      org.opencontainers.image.licenses="BUSL-1.1"

RUN apk add --no-cache \
    bash \
    ca-certificates \
    chromium \
    cronie \
    curl \
    dumb-init \
    ttf-dejavu \
    ttf-freefont \
    tzdata

WORKDIR /app

ENV NODE_ENV=production \
    TRADEJS_GIT_SHA=${TRADEJS_GIT_SHA} \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# This large layer changes only when workspace dependency manifests change.
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=production-dependencies /app/.yarn ./.yarn

COPY --from=builder /app/apps ./apps
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/proto ./proto
COPY --from=builder /app/bin ./bin
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/tsconfig.base.json ./tsconfig.base.json
COPY --from=builder /app/tsconfig.packages.json ./tsconfig.packages.json
COPY --from=builder /app/tradejs.config.ts ./tradejs.config.ts
COPY entrypoint.sh ./entrypoint.sh
COPY cronjob /etc/crontabs/root

RUN chmod +x ./entrypoint.sh ./bin/*.sh

EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./entrypoint.sh"]
