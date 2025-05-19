#!/bin/sh

cd /app

exec yarn bot >> /var/log/cron.log 2>&1
