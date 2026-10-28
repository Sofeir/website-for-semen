#!/bin/bash
# Автообновление: сервер следит за веткой release на GitHub. В main изменения попадают сами, а в release только по команде
# владельца (workflow «Выложить на сервер»). Когда release сдвинулась (вперёд или назад, это и есть откат),
# скрипт пересобирает и перезапускает контейнеры. Запускается по расписанию (cron) раз в минуту от root.
# Данные не затрагиваются: база и вложения лежат в томах Docker.
# Любая причина, по которой обновление не прошло, записывается в журнал /var/log/servicedesk-update.log
# (одна и та же ошибка подряд пишется один раз, чтобы журнал не разрастался).
set -eo pipefail

LOG="${SERVICEDESK_LOG:-/var/log/servicedesk-update.log}"
LOCK="${SERVICEDESK_LOCK:-/var/lock/servicedesk-update.lock}"
# у cron очень короткий PATH: без этого git и docker могут не найтись
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
# то же, но не повторяет предыдущую строку журнала
log_once() {
  if ! tail -n 1 "$LOG" 2>/dev/null | grep -qF -- "$*"; then log "$*"; fi
}

cd "$(dirname "$(readlink -f "$0")")/.."
# папка проекта может принадлежать другому пользователю: без этого git отказывается работать от root
g() { git -c safe.directory="$PWD" "$@"; }

# одновременно работает только один запуск: сборка может идти дольше минуты
exec 9> "$LOCK"
if ! flock -n 9; then exit 0; fi

fail() { log_once "ОШИБКА: $1"; exit 1; }
trap 'log_once "ОШИБКА: команда завершилась с кодом $? на строке $LINENO"' ERR

command -v git > /dev/null || fail "не найден git"
command -v docker > /dev/null || fail "не найден docker"

if ! out=$(g fetch -q origin release 2>&1); then
  fail "не удалось получить обновление с GitHub: ${out//$'\n'/ }"
fi

# что собрано и запущено успешно, запоминаем в файле: если сборка упала, на следующей минуте она повторится
# (раньше после неудачной сборки код уже был обновлён, и скрипт считал, что делать нечего)
built_file="$(g rev-parse --git-dir)/servicedesk-built"
if [ "$(cat "$built_file" 2> /dev/null)" = "$(g rev-parse origin/release)" ]; then
  exit 0
fi

# свои правки в файлах программы (например, включённый https в deploy/angie.conf) не затираем
if ! g diff --quiet HEAD; then
  fail "обновление пропущено: на сервере изменены файлы программы (git status)"
fi

target=$(g rev-parse origin/release)
failed_file="$(g rev-parse --git-dir)/servicedesk-failed"
# о неудачной сборке одной и той же версии пишем в журнал один раз, хотя пробуем каждую минуту
repeat=false
[ "$(cat "$failed_file" 2> /dev/null)" = "$target" ] && repeat=true
$repeat || log "начато обновление до ${target:0:7}"
g reset -q --hard origin/release

build=$(mktemp)
if ! docker compose up -d --build > "$build" 2>&1; then
  if ! $repeat; then
    log "ОШИБКА: сборка не прошла (повторим через минуту), последние строки:"
    tail -n 15 "$build" >> "$LOG"
    echo "$target" > "$failed_file"
  fi
  rm -f "$build"
  exit 1
fi
rm -f "$build" "$failed_file"
echo "$target" > "$built_file"
docker image prune -f > /dev/null || true
log "обновлено до $(g rev-parse --short HEAD)"
