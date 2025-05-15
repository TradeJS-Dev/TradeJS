FROM node:18-alpine

RUN apk add --no-cache curl bash tzdata dumb-init cronie

WORKDIR /app

COPY . .

RUN yarn

RUN yarn build

COPY cronjob /etc/crontabs/root

RUN chmod +x ./entrypoint.sh
RUN chmod u+w ./data

EXPOSE 3000

CMD ["./entrypoint.sh"]
