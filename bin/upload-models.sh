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

# Upload only production model artifacts and skip archive files.
FILE_LIST="$(mktemp)"
trap 'rm -f "$FILE_LIST"' EXIT

(
  cd "$MODELS_DIR"
  find . -mindepth 1 \( -type f -o -type l \) \
    -name "*.prod.*" \
    ! -name "*.tar" \
    ! -name "*.tgz" \
    ! -name "*.tar.gz" \
    ! -name "*.tar.bz2" \
    ! -name "*.tar.xz" \
    ! -name "*.zip" \
    ! -name "*.7z" \
    | LC_ALL=C sort > "$FILE_LIST"
)

if [[ ! -s "$FILE_LIST" ]]; then
  echo "No production artifacts found in: $MODELS_DIR" >&2
  exit 1
fi

echo "Files to upload:"
sed 's#^\./##' "$FILE_LIST"

if tar --version 2>/dev/null | grep -qi "gnu tar"; then
  (cd "$MODELS_DIR" && tar -cf - -T "$FILE_LIST") | \
    ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
    "tar -xpf - -C $REMOTE_DIR"
else
  (cd "$MODELS_DIR" && tar --no-xattrs -cf - -T "$FILE_LIST") | \
    ssh -i "$SSH_KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=no "$SSH_USER@$SSH_HOST" \
    "tar -xpf - -C $REMOTE_DIR"
fi
