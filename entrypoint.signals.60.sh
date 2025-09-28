#!/usr/bin/env sh

set -e

cd /app
exec /usr/local/bin/yarn run signals --timeframe 60 --updateOnly
exec /usr/local/bin/yarn run signals --timeframe 60 --cacheOnly --offset 3
