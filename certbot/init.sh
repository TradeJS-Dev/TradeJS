#!/bin/sh
if [ ! -d "/etc/letsencrypt/live/bff.sndsy.ru" ]; then
  certbot certonly --webroot -w /var/www/certbot \
    --email services@iprojects.ru --agree-tos --no-eff-email \
    -d bff.sndsy.ru
fi
