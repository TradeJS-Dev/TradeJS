#!/bin/sh

cd /app

/usr/local/bin/node /usr/local/bin/yarn bot >> /var/log/cron.log 2>&1
