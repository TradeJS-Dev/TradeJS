FROM node:20-alpine

RUN apk add --no-cache \
    curl \
    bash \
    tzdata \
    dumb-init \
    cronie \
    nano \
    htop

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-dejavu \
    ttf-freefont \
    htop \
    ca-certificates

WORKDIR /app

COPY . .

# COPY package.json yarn.lock .yarn .yarnrc.yml ./

RUN yarn

# COPY . .

RUN yarn build

COPY cronjob /etc/crontabs/root

RUN chmod +x ./entrypoint.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]
