#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <config> [user] [container]" >&2
  exit 1
fi

config="$1"
user_name="${2:-root}"
container="${3:-inv-redis}"
key="users:${user_name}:backtests:configs:${config}"

# RedisJSON returns one root match in an array. Print the config object itself.
payload="$(docker exec "$container" redis-cli --raw JSON.GET "$key" '$')"
if [[ -z "$payload" ]]; then
  echo "Backtest config not found: ${key}" >&2
  exit 1
fi

printf '%s\n' "$payload" | jq 'if type == "array" and length == 1 then .[0] else . end'
