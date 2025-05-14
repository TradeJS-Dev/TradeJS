#!/bin/bash

echo ">>> Запускаем nginx без SSL"
docker compose up -d nginx

echo ">>> Выпрашиваем сертификат certbot"
docker compose run --rm certbot

echo ">>> Перезапускаем nginx с SSL"
docker compose restart nginx

echo ">>> Готово!"
