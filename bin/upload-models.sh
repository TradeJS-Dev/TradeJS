#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -n "${SSH_KEY:-}" && "${SSH_KEY}" != /* ]]; then
  SSH_KEY="${HOME}/.ssh/${SSH_KEY}"
else
  SSH_KEY="${SSH_KEY:-${HOME}/.ssh/id_rsa}"
fi

if [[ -z "${SSH_HOST:-}" || -z "${SSH_USER:-}" ]]; then
  echo "Missing required env vars: SSH_HOST, SSH_USER (from .env or environment)" >&2
  exit 1
fi

if [[ ! -f "$SSH_KEY" ]]; then
  echo "SSH key not found: $SSH_KEY" >&2
  exit 1
fi

SSH_PORT="${SSH_PORT:-22}"
REMOTE_DIR="${REMOTE_DIR:-~/data/ml/models}"

ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" "mkdir -p \"$REMOTE_DIR\""
scp -i "$SSH_KEY" -P "$SSH_PORT" -o StrictHostKeyChecking=no -r data/ml/models/. "$SSH_USER@$SSH_HOST:$REMOTE_DIR/"
