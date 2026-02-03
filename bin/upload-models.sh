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

if [[ -n "${MODELS_DIR:-}" ]]; then
  if [[ "${MODELS_DIR}" != /* ]]; then
    MODELS_DIR="$(pwd)/${MODELS_DIR}"
  fi
else
  MODELS_DIR="$(pwd)/data/ml/models"
fi

MODELS_DIR="$(cd "$MODELS_DIR" && pwd -P)"

if [[ ! -d "$MODELS_DIR" ]]; then
  echo "Models directory not found: $MODELS_DIR" >&2
  exit 1
fi

ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" "mkdir -p $REMOTE_DIR"

# Stream a sorted archive so uploads happen in alphabetical order.
(cd "$MODELS_DIR" && tar --sort=name -cf - .) | \
  ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
  "tar -xpf - -C $REMOTE_DIR"
