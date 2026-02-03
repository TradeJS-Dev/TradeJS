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

COPY package.json yarn.lock .yarn .yarnrc.yml ./

RUN yarn

COPY next.config.mjs tsconfig.json next-env.d.ts postcss.config.js ./
COPY src ./src
COPY public ./public
COPY proto ./proto
COPY entrypoint.sh ./entrypoint.sh
COPY cronjob /etc/crontabs/root

RUN yarn build

RUN chmod +x ./entrypoint.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]
