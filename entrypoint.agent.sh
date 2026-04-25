#!/usr/bin/env sh

set -e

cp /app/cronjob.agent /etc/crontabs/root

exec crond -f -P
