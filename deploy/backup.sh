#!/bin/bash
# Резервная копия: база данных и вложения. Хранятся 14 дней в /var/backups/servicedesk.
# Запускается по расписанию (cron) раз в сутки от root.
# В копиях телефоны клиентов и хэши паролей, поэтому папка и файлы доступны только владельцу (root).
set -e
umask 077
cd "$(dirname "$(readlink -f "$0")")/.."
dir=/var/backups/servicedesk
install -d -m 700 "$dir"
day=$(date +%F)
docker compose exec -T db pg_dump -U servicedesk servicedesk | gzip > "$dir/servicedesk-$day.sql.gz"
docker run --rm -v servicedesk_uploads:/data:ro -v "$dir":/backup alpine \
  sh -c "umask 077 && tar czf /backup/uploads-$day.tar.gz -C /data ."
chmod 600 "$dir"/*-"$day".*
find "$dir" -type f -mtime +14 -delete
