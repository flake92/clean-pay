# Clean Pay: деплой на тестовый стенд

Документ описывает деплой Clean Pay на стенд `host1.clear-vpn.org:6088`.

## Что поднимается

- Каталог приложения: `/opt/clean-pay`
- Compose project: `clean-pay`
- Контейнеры:
  - `clean-pay-web`
  - `clean-pay-postgres`
  - `clean-pay-redis`
- Внутренний debug-port: `127.0.0.1:4010 -> clean-pay-web:3000`
- Публичный домен: `https://oplata.clear-vpn.org`
- Внешний reverse proxy: существующий Caddy из Remnawave

Встроенный Caddy из Clean Pay не запускается.

## Файлы на сервере

```text
/opt/clean-pay/
  .env
  docker-compose.teststand.yml
  deploy-clean-pay-teststand.sh
  patch-caddy-clean-pay.sh
  ...
```

`/opt/clean-pay/.env` содержит реальные секреты и должен иметь права `600`.

## Обязательные переменные Remnashop

Чтобы Remnashop отдавал пользователю ссылку на Clean Pay web cabinet, в `/opt/remnashop/.env` должны быть включены web-переменные:

```env
WEB_ENABLED=true
WEB_CABINET_URL=https://oplata.clear-vpn.org
```

При `WEB_ENABLED=true` Remnashop также требует отдельные секреты web-части. Нельзя переиспользовать `APP_CRYPT_KEY`.

```env
APP_API_KEY=<random-hex-64>
APP_JWT_SECRET=<random-hex-64>
```
Для отправки кодов подтверждения e-mail Remnashop использует отдельный email-конфиг. Clean Pay не отправляет письма напрямую, поэтому в `/opt/remnashop/.env` обязательно должны быть заданы:

```env
EMAIL_ENABLED=true
EMAIL_HOST=clear-vpn.org
EMAIL_PORT=587
EMAIL_USE_TLS=true
EMAIL_USE_SSL=false
EMAIL_USERNAME=code@clear-vpn.org
EMAIL_PASSWORD=<password>
EMAIL_FROM_EMAIL=code@clear-vpn.org
EMAIL_FROM_NAME=CleanVPN
EMAIL_VERIFICATION_CODE_TTL_MINUTES=15
```

Если этих переменных нет, запрос Clean Pay на `/auth/email/request-verification` проксируется в Remnashop и получает ошибку `Email delivery is not configured`, а код подтверждения не отправляется.

После изменения `/opt/remnashop/.env` нужно перезапустить Remnashop:

```bash
cd /opt/remnashop
docker compose --env-file .env -f docker-compose.yml up -d --force-recreate remnashop remnashop-taskiq-worker remnashop-taskiq-scheduler
curl -sS http://127.0.0.1:5000/health
```

## Упрощенный деплой одной compose-командой

Идеальная схема деплоя Clean Pay на стенде:

1. В `/opt/clean-pay` лежит код проекта.
2. В `/opt/clean-pay/.env` заполнены переменные Clean Pay.
3. В `/opt/clean-pay/docker-compose.teststand.yml` лежит compose-файл из `scripts/teststand/docker-compose.teststand.yml`.
4. Remnashop один раз настроен через `/opt/remnashop/.env`.
5. Caddy один раз содержит reverse proxy блок для `oplata.clear-vpn.org`.
6. Запуск Clean Pay выполняется одной командой:

```bash
cd /opt/clean-pay
docker compose -p clean-pay --env-file .env -f docker-compose.teststand.yml up -d --build --force-recreate
```

Compose сам выполняет весь порядок:

- собирает production image `clean-pay-web`;
- поднимает `clean-pay-postgres` и `clean-pay-redis`;
- запускает одноразовый сервис `clean-pay-migrate`;
- применяет Prisma migrations;
- запускает `clean-pay-web` только после успешных миграций.

Отдельно запускать `npx prisma migrate deploy` больше не нужно. Standalone production image не содержит `prisma/schema.prisma`, поэтому миграции вынесены в отдельный Dockerfile stage `migrate` и compose service `migrate`.

## Быстрый повторный деплой

1. Собрать архив локального проекта без runtime-мусора:

```powershell
tar -czf work\clean-pay-teststand.tar.gz `
  -C C:\code\clean-pay `
  --exclude .git `
  --exclude node_modules `
  --exclude .next `
  --exclude .next-mock `
  --exclude .env `
  --exclude .env.local `
  .
```

2. Загрузить архив:

```powershell
scp -P 6088 work\clean-pay-teststand.tar.gz root@host1.clear-vpn.org:/opt/clean-pay-teststand.tar.gz
```

3. На сервере распаковать в `/opt/clean-pay`, скопировать compose из `scripts/teststand` в корень и заполнить `/opt/clean-pay/.env`.

4. Запустить одной командой:

```bash
cd /opt/clean-pay
docker compose -p clean-pay --env-file .env -f docker-compose.teststand.yml up -d --build --force-recreate
```

5. Если менялся Caddyfile или домен ещё не добавлен, применить Caddy один раз:

```bash
cd /opt/clean-pay
./patch-caddy-clean-pay.sh
docker restart caddy
```

`docker restart caddy` нужен, если Caddyfile был заменен через `mv`: bind mount файла держит старый inode.

## Проверки

```bash
docker ps --filter name=clean-pay
curl -sS http://127.0.0.1:4010/api/health
docker exec caddy wget -S -O- http://clean-pay-web:3000/api/health
curl -k -I https://oplata.clear-vpn.org/login
curl -k https://oplata.clear-vpn.org/api/health
```

Ожидаемо:

```text
/api/health -> 200 OK
/login -> 200 OK
clean-pay-web -> healthy
```

## Caddy

Фактический Caddyfile:

```text
/opt/remnawave/caddy/Caddyfile
```

Блок Clean Pay:

```caddyfile
oplata.clear-vpn.org {
  encode gzip zstd
  reverse_proxy clean-pay-web:3000 {
    header_up Host {host}
    header_up X-Forwarded-Host {host}
    header_up X-Forwarded-Proto {scheme}
    header_up X-Forwarded-Port 443
    header_up X-Real-IP {remote_host}
    header_up X-Forwarded-For {remote_host}
  }
}
```

Контейнер Caddy должен быть в сети `remnawave-network`. `clean-pay-web` тоже подключен к этой сети.

## Известные проблемы текущего стенда

1. `/api/health/readiness` в текущей сборке Clean Pay возвращает `401 Unauthorized`.
   Похоже, route попадает под auth middleware. Для полноценного readiness endpoint его нужно исключить из auth-защиты в коде.


## Текущий результат деплоя

- Clean Pay развернут в `/opt/clean-pay`.
- Prisma migrations применены через compose service `clean-pay-migrate`.
- `clean-pay-web`, `clean-pay-postgres`, `clean-pay-redis` запущены.
- Caddy видит `oplata.clear-vpn.org`.
- Let's Encrypt сертификат для `oplata.clear-vpn.org` получен.
- `https://oplata.clear-vpn.org/api/health` со стенда возвращает `200`.
- Remnashop `.env` содержит `WEB_ENABLED=true`, `WEB_CABINET_URL=https://oplata.clear-vpn.org`, `APP_API_KEY`, `APP_JWT_SECRET`, а также email-параметры `EMAIL_ENABLED`, `EMAIL_HOST`, `EMAIL_USERNAME`, `EMAIL_PASSWORD`, `EMAIL_FROM_EMAIL`.
- `https://bot8.clear-vpn.org/health` возвращает `200`.
- `https://bot8.clear-vpn.org/api/v1/public/plans/public` возвращает `200`, ответ `{"plans":[]}`.
