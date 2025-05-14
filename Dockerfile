FROM node:18-alpine

WORKDIR /app

COPY package.json .yarn .yarnrc.yml yarn.lock ./

RUN yarn

COPY . .

EXPOSE 3000

RUN yarn build

CMD ["yarn", "run", "start"]
