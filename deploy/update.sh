#!/bin/bash
# Автообновление: сервер следит за веткой release на GitHub. В main изменения попадают сами, а в release только по команде
# владельца (workflow «Выложить на сервер»). Когда release сдвинулась (вперёд или назад, это и есть откат),
# скрипт пересобирает и перезапускает контейнеры. Запускается по расписанию (cron) раз в минуту от root.
# Данные не затрагиваются: база и вложения лежат в томах Docker.
set -e
cd "$(dirname "$(readlink -f "$0")")/.."
git fetch -q origin release
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/release)" ]; then
  exit 0
fi
# свои правки в файлах программы (например, включённый https в deploy/angie.conf) не затираем
if ! git diff --quiet HEAD; then
  echo "$(date '+%F %T') обновление пропущено: на сервере изменены файлы программы (git status)" >> /var/log/servicedesk-update.log
  exit 1
fi
git reset -q --hard origin/release
docker compose up -d --build
docker image prune -f > /dev/null
echo "$(date '+%F %T') обновлено до $(git rev-parse --short HEAD)" >> /var/log/servicedesk-update.log
