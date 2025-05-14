FROM node:18-alpine

WORKDIR /app

COPY . .

RUN yarn

EXPOSE 3000

RUN yarn build

CMD ["yarn", "run", "start"]
