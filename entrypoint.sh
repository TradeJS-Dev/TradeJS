#!/usr/bin/env sh

set -e

crond -f -P &

exec yarn run start
