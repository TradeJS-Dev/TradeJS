#!/usr/bin/env sh

set -e

crond -f -L /var/log/cron.log &

exec yarn run start
