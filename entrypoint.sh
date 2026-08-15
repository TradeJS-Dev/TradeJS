#!/usr/bin/env bash

set -Eeuo pipefail

readonly SIGNALS_LOG_PATH="${SIGNALS_LOG_PATH:-/var/log/cron.signals.15.log}"
declare -a managed_pids=()

append_bool_flag() {
  local flag="$1"
  local value="$2"

  case "${value,,}" in
    1 | true | yes | on)
      signals_args+=("$flag")
      ;;
    0 | false | no | off | '')
      ;;
    *)
      printf 'Invalid boolean value for %s: %s\n' "$flag" "$value" >&2
      exit 1
      ;;
  esac
}

shutdown() {
  local exit_status="${1:-0}"

  trap - INT TERM
  for pid in "${managed_pids[@]}"; do
    kill -TERM "$pid" 2>/dev/null || true
  done
  for pid in "${managed_pids[@]}"; do
    wait "$pid" 2>/dev/null || true
  done

  exit "$exit_status"
}

trap 'shutdown 0' INT TERM

touch "$SIGNALS_LOG_PATH"

signals_args=(
  signals-daemon
  --timeframe "${SIGNALS_DAEMON_TIMEFRAME:-15}"
)

if [ -n "${SIGNALS_DAEMON_DEPLOYMENT_ID:-}" ]; then
  signals_args+=(--deployment "$SIGNALS_DAEMON_DEPLOYMENT_ID")
fi

if [ -n "${SIGNALS_DAEMON_CHUNK:-1/1}" ]; then
  signals_args+=(--chunk "${SIGNALS_DAEMON_CHUNK:-1/1}")
fi

append_bool_flag --notify "${SIGNALS_DAEMON_NOTIFY:-true}"
append_bool_flag --makeOrders "${SIGNALS_DAEMON_MAKE_ORDERS:-true}"
append_bool_flag --showSkipStats "${SIGNALS_DAEMON_SHOW_SKIP_STATS:-true}"

if [ -n "${SIGNALS_DAEMON_EXTRA_ARGS:-}" ]; then
  read -r -a extra_signal_args <<<"$SIGNALS_DAEMON_EXTRA_ARGS"
  signals_args+=("${extra_signal_args[@]}")
fi

printf 'Starting signals-daemon:'
printf ' %q' "${signals_args[@]}"
printf '\n'

crond -f -P &
cron_pid=$!
managed_pids+=("$cron_pid")

(
  set -o pipefail
  PROJECT_CWD=/app \
    DOTENV_CONFIG_PATH=/app/.env \
    NODE_OPTIONS="--max-old-space-size=${SIGNALS_DAEMON_HEAP_MB:-4096}" \
    bash ./bin/run-cli-runtime.sh "${signals_args[@]}" 2>&1 | tee -a "$SIGNALS_LOG_PATH"
) &
signals_pid=$!
managed_pids+=("$signals_pid")

(
  PROJECT_CWD=/app \
    DOTENV_CONFIG_PATH=/app/.env \
    NODE_OPTIONS="--max-old-space-size=${MARKET_WS_HEAP_MB:-256}" \
    bash ./bin/run-cli-runtime.sh market-ws
) &
market_ws_pid=$!
managed_pids+=("$market_ws_pid")

node ./apps/app/bin/tradejs-app.mjs start &
app_pid=$!
managed_pids+=("$app_pid")

set +e
wait -n -p exited_pid "${managed_pids[@]}"
exit_status=$?
set -e

case "$exited_pid" in
  "$cron_pid") process_name='crond' ;;
  "$signals_pid") process_name='signals-daemon' ;;
  "$market_ws_pid") process_name='market-ws' ;;
  "$app_pid") process_name='app' ;;
  *) process_name="pid $exited_pid" ;;
esac

printf 'Managed process exited: %s (status=%s)\n' "$process_name" "$exit_status" >&2
if ((exit_status == 0)); then
  exit_status=1
fi
shutdown "$exit_status"
