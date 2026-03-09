#!/bin/bash

COMPOSE_FILES="-f docker-compose.prod.yml"

echo ">>> Запускаем nginx без SSL"
docker compose $COMPOSE_FILES up -d docs nginx

echo ">>> Выпрашиваем сертификат certbot"
docker compose $COMPOSE_FILES run --rm certbot

echo ">>> Перезапускаем nginx с SSL"
docker compose $COMPOSE_FILES restart nginx

echo ">>> Готово!"
