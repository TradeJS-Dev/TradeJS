#!/usr/bin/env sh

set -e

crond -f -P -l 8 &

exec yarn run start
