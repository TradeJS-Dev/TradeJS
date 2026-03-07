#!/usr/bin/env sh

set -e

cd /app

# Cronie jobs run with a reduced environment. Load project .env explicitly.
if [ -f /app/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /app/.env
  set +a
fi

exec /usr/local/bin/yarn run "$@"
