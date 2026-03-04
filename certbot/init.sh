#!/bin/sh
if [ ! -d "/etc/letsencrypt/live/aleksnick01inv.fvds.ru" ]; then
  certbot certonly --webroot -w /var/www/certbot \
    --email aleksnick01@gmail.com --agree-tos --no-eff-email \
    -d aleksnick01inv.fvds.ru \
    -d redisinsight.aleksnick01inv.fvds.ru \
    -d docs.aleksnick01inv.fvds.ru
fi
