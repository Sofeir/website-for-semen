#!/bin/bash
# Резервная копия: база данных и вложения. Хранятся 14 дней в /var/backups/servicedesk.
# Запускается по расписанию (cron) раз в сутки от root.
set -e
cd "$(dirname "$(readlink -f "$0")")/.."
mkdir -p /var/backups/servicedesk
day=$(date +%F)
docker compose exec -T db pg_dump -U servicedesk servicedesk | gzip > "/var/backups/servicedesk/servicedesk-$day.sql.gz"
docker run --rm -v servicedesk_uploads:/data:ro -v /var/backups/servicedesk:/backup alpine \
  tar czf "/backup/uploads-$day.tar.gz" -C /data .
find /var/backups/servicedesk -type f -mtime +14 -delete
