#!/bin/sh

# Запускаем cron в фоне
crond

# Запускаем основное приложение
exec yarn run start
