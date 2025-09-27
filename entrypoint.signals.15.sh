#!/bin/sh
set -e
export PATH=/usr/local/bin:/usr/bin:/bin

cd /app
exec /usr/local/bin/yarn run signals --timeframe 15
