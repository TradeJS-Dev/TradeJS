#!/bin/sh
if [ ! -d "/etc/letsencrypt/live/tradejs.dev" ]; then
  certbot certonly --webroot -w /var/www/certbot \
    --email aleksnick01@gmail.com --agree-tos --no-eff-email \
    -d tradejs.dev \
    -d redisinsight.tradejs.dev \
    -d docs.tradejs.dev
fi
