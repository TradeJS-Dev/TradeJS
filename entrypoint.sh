#!/usr/bin/env sh

set -e

crond -P

exec env YARN_IGNORE_PATH=1 yarn run start
