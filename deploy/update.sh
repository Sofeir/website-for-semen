#!/bin/bash
# Автообновление: если в main на GitHub появились изменения, пересобирает и перезапускает контейнеры.
# Запускается по расписанию (cron) раз в минуту от root. Данные не затрагиваются: база в PostgreSQL, вложения в /var/lib/servicedesk/uploads.
set -e
cd /opt/servicedesk
git fetch -q origin main
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  git merge -q --ff-only origin/main
  docker compose up -d --build
  docker image prune -f > /dev/null
  echo "$(date '+%F %T') обновлено до $(git rev-parse --short HEAD)" >> /var/log/servicedesk-update.log
fi
