#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <config> [container]" >&2
  exit 1
fi

config="$1"
container="${2:-inv-redis}"

# Read the JSON config from Redis in the specified container.
docker exec "$container" redis-cli GET "backtests:${config}"
