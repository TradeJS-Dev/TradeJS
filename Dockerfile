FROM node:24-alpine

LABEL org.opencontainers.image.source="https://github.com/TradeJS-Dev/TradeJS" \
      org.opencontainers.image.description="TradeJS app" \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache \
    curl \
    bash \
    tzdata \
    dumb-init \
    cronie \
    nano \
    htop \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-dejavu \
    ttf-freefont \
    ca-certificates

WORKDIR /app

ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json yarn.lock .yarnrc.yml turbo.json tsconfig.json tsconfig.base.json tsconfig.packages.json tradejs.config.ts ./
COPY .yarn ./.yarn
COPY apps/app/package.json ./apps/app/package.json

RUN corepack enable
RUN corepack prepare yarn@4.13.0 --activate

COPY apps ./apps
COPY packages ./packages
COPY examples ./examples
RUN yarn install --immutable

COPY proto ./proto
COPY bin ./bin
COPY entrypoint.sh ./entrypoint.sh
COPY cronjob /etc/crontabs/root

RUN yarn turbo run build --filter=@tradejs/cli... --filter=@tradejs/app...

RUN chmod +x ./entrypoint.sh ./bin/*.sh

EXPOSE 3000 3001

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["./entrypoint.sh"]
