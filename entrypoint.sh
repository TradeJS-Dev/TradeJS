#!/usr/bin/env sh

set -e

crond -P

exec yarn run start
