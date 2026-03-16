FROM node:20-alpine

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

COPY package.json yarn.lock .yarnrc.yml turbo.json tsconfig.json tsconfig.base.json tsconfig.packages.json tradejs.config.ts ./
COPY .yarn ./.yarn

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

RUN yarn workspace @tradejs/cli build
RUN yarn turbo run build --filter=@tradejs/app

RUN chmod +x ./entrypoint.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]
