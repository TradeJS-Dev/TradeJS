FROM node:20-alpine

RUN apk add --no-cache curl bash tzdata dumb-init cronie nano

WORKDIR /app

RUN apk add --no-cache htop

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ttf-dejavu \
    ca-certificates

COPY . .

# COPY package.json yarn.lock .yarn .yarnrc.yml ./

RUN yarn

# COPY . .

RUN yarn build

COPY cronjob /etc/crontabs/root

RUN chmod +x ./entrypoint.sh
RUN chmod +x ./entrypoint.bot.sh
RUN chmod +x ./entrypoint.signals.15.sh
RUN chmod +x ./entrypoint.signals.60.sh

EXPOSE 3000

CMD ["./entrypoint.sh"]
