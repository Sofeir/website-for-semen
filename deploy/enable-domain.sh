#!/usr/bin/env bash
# Включает https и работу сервиса на домене (например, crm.adminstart.ru).
#
# Запуск на сервере из папки проекта:
#   sudo bash deploy/enable-domain.sh crm.adminstart.ru admin@adminstart.ru
# Второй параметр — почта, на которую Let's Encrypt шлёт предупреждения о сертификате.
#
# Что делает: проверяет, что домен указывает на этот сервер; выпускает бесплатный сертификат; кладёт настройки домена
# в /etc/servicedesk-https (вне git, обновление программы их не затирает); прописывает адреса в .env;
# перечитывает настройки Angie без остановки сайта; ставит автообновление сертификата; проверяет результат.
# Скрипт можно запускать повторно: сделанное повторно не ломается.
set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Использование: sudo bash deploy/enable-domain.sh ДОМЕН ПОЧТА"
  echo "Пример:        sudo bash deploy/enable-domain.sh crm.adminstart.ru admin@adminstart.ru"
  exit 1
fi
if ! [[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || [[ "$DOMAIN" != *.* ]]; then
  echo "Домен «$DOMAIN» выглядит неверно. Нужен вид crm.adminstart.ru"
  exit 1
fi
if [ "$(id -u)" != "0" ]; then
  echo "Запустите через sudo: sudo bash deploy/enable-domain.sh $DOMAIN $EMAIL"
  exit 1
fi

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
[ -f docker-compose.yml ] && [ -f .env ] || { echo "Запускайте из папки проекта: нет docker-compose.yml или .env"; exit 1; }
COMPOSE="docker compose -f $ROOT/docker-compose.yml"

step() { echo; echo "== $1"; }

step "1. Проверка: домен $DOMAIN должен указывать на этот сервер"
SERVER_IP="$(curl -fsS --max-time 10 https://api.ipify.org || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}' || true)"
echo "Внешний адрес сервера: ${SERVER_IP:-не определён}; домен указывает на: ${DNS_IP:-никуда}"
if [ -z "$DNS_IP" ]; then
  echo "Домен пока не указывает никуда. Добавьте в DNS запись A: имя ${DOMAIN%%.*}, значение ${SERVER_IP:-внешний адрес сервера}. Через несколько минут запустите скрипт снова."
  exit 1
fi
if [ -n "$SERVER_IP" ] && [ "$SERVER_IP" != "$DNS_IP" ]; then
  echo "Домен указывает на $DNS_IP, а внешний адрес сервера $SERVER_IP. Исправьте запись A в DNS и запустите скрипт снова."
  exit 1
fi

step "2. Папки и certbot"
mkdir -p /var/www/certbot /etc/servicedesk-https
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y certbot
fi

step "3. Angie с папкой проверки домена"
$COMPOSE up -d --force-recreate angie
sleep 3

step "4. Сертификат Let's Encrypt"
certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --keep-until-expiring
CERT="/etc/letsencrypt/live/$DOMAIN"
[ -f "$CERT/fullchain.pem" ] || { echo "Сертификат не выпущен. Проверьте, что порт 80 снаружи ведёт на этот сервер."; exit 1; }

step "5. Настройки домена для Angie"
CONF="/etc/servicedesk-https/$DOMAIN.conf"
cat > "$CONF" <<'EOF'
# Создано deploy/enable-domain.sh. Домен __DOMAIN__: http перенаправляет на https.
server {
    listen 80;
    server_name __DOMAIN__;
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name __DOMAIN__;
    ssl_certificate     /etc/letsencrypt/live/__DOMAIN__/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/__DOMAIN__/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Robots-Tag "noindex, nofollow" always;

    set $app_upstream app:8431;
    client_max_body_size 35m;

    location = /robots.txt {
        default_type text/plain;
        return 200 "User-agent: *\nDisallow: /\n";
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    location /api/events {
        proxy_pass http://$app_upstream;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://$app_upstream;
        proxy_http_version 1.1;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
EOF
sed -i "s/__DOMAIN__/$DOMAIN/g" "$CONF"
if ! $COMPOSE exec -T angie angie -t; then
  echo "Angie не принял настройки, убираю их, сайт продолжает работать как раньше."
  rm -f "$CONF"
  exit 1
fi
$COMPOSE exec -T angie angie -s reload

step "6. Адреса в .env"
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}
cp .env ".env.before-domain"
set_env PUBLIC_URL "https://$DOMAIN"
set_env ALLOWED_ORIGINS "https://$DOMAIN"
set_env COOKIE_SECURE "true"
echo "Прежний .env сохранён как .env.before-domain"

step "7. Перезапуск приложения"
$COMPOSE up -d --force-recreate app
sleep 5

step "8. Автообновление сертификата"
cat > /etc/cron.d/servicedesk-certbot <<EOF
17 3 * * * root certbot renew --quiet --deploy-hook "docker compose -f $ROOT/docker-compose.yml exec -T angie angie -s reload"
EOF
chmod 644 /etc/cron.d/servicedesk-certbot

step "9. Проверка"
if curl -fsS --max-time 15 "https://$DOMAIN/api/health" >/dev/null; then
  echo "Готово: https://$DOMAIN открывается."
  echo "Войти можно по адресу https://$DOMAIN. Старый адрес по IP без https больше не подходит для входа."
else
  echo "https://$DOMAIN пока не отвечает. Журнал: $COMPOSE logs --tail 30 app angie"
  exit 1
fi
