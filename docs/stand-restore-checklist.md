# Clean Pay Stand Restore Checklist

Этот файл нужен на случай, если стенд откатили до состояния, где уже работают только Remnashop и Remnawave, а Clean Pay нужно развернуть заново.

Секреты сюда не записываем. Локальный снимок переменных для быстрого восстановления хранится в ignored-файле:

```text
deploy/prod/stand-restore.clean-pay.env
```

## 1. Что Должно Уже Работать

- Remnashop доступен по публичному домену.
- Remnashop public API доступен по URL вида `https://bot.example.com/api/v1/public`.
- Remnawave panel доступна по публичному URL вида `https://panel.example.com`.
- В Remnawave создан API token для Clean Pay.
- В Remnawave и Remnashop совпадает webhook secret:
  - Remnawave: `WEBHOOK_SECRET_HEADER`
  - Remnashop: `REMNAWAVE_WEBHOOK_SECRET`
- Docker network `remnawave-network` либо уже существует, либо будет создан `sh start.sh`.

## 2. Clean Pay `.env`

Создать файл:

```bash
cp deploy/prod/.env.example deploy/prod/.env
```

Затем перенести значения из локального снимка:

```bash
deploy/prod/stand-restore.clean-pay.env
```

Критичные переменные Clean Pay:

| Переменная | Что указать |
| --- | --- |
| `APP_URL` | Публичный URL Clean Pay, например `https://oplata.example.com` |
| `NEXT_PUBLIC_APP_URL` | Обычно тот же URL, что и `APP_URL` |
| `REMNASHOP_API_BASE_URL` | Public API Remnashop, например `https://bot.example.com/api/v1/public` |
| `REMNAWAVE_API_BASE_URL` | URL Remnawave panel/API без `/api`, например `https://panel.example.com` |
| `REMNAWAVE_TOKEN` | API token из Remnawave panel |
| `TELEGRAM_BOT_TOKEN` | Токен того же Telegram-бота, который использует Remnashop |
| `TELEGRAM_OIDC_CLIENT_ID` | Числовая часть `TELEGRAM_BOT_TOKEN` до `:` |
| `TELEGRAM_OIDC_CLIENT_SECRET` | Telegram OAuth client secret |
| `WEB_JWT_SECRET` | Длинный случайный секрет |
| `WEB_REFRESH_SECRET` | Длинный случайный секрет |
| `AUDIT_IP_HASH_SECRET` | Длинный случайный секрет, отдельно от JWT |
| `COOKIE_SECURE` | `true` для HTTPS production |
| `COOKIE_SAMESITE` | Обычно `lax` |
| `NEXT_PUBLIC_BRAND_NAME` | Название кабинета, если нужно заменить `Clean Pay` |
| `NEXT_PUBLIC_BRAND_LOGO_URL` | Root-relative path логотипа, например `/logo.svg` |

## 3. Remnashop

Проверить во внешнем Remnashop:

| Переменная | Ожидаемое значение |
| --- | --- |
| `APP_DOMAIN` | Домен Remnashop без протокола |
| `APP_CRYPT_KEY` | Валидный 44-символьный Base64 key |
| `APP_LOCALES` | Должен содержать `ru` |
| `APP_DEFAULT_LOCALE` | Сейчас `ru` |
| `WEB_ENABLED` | Должно быть `true`, иначе Remnashop не подключит `/api/v1/public/*` |
| `WEB_CABINET_URL` | URL Clean Pay Telegram WebApp, например `https://pay.example.com/auth/telegram/webapp` |
| `APP_API_KEY` | Длинный random secret, обязателен при `WEB_ENABLED=true` |
| `APP_JWT_SECRET` | Длинный random secret, обязателен при `WEB_ENABLED=true` |
| `BOT_TOKEN` | Токен Telegram-бота |
| `BOT_SECRET_TOKEN` | Secret Telegram webhook |
| `BOT_OWNER_ID` | Telegram ID владельца |
| `BOT_SUPPORT_USERNAME` | Username поддержки без `@` |
| `BOT_MINI_APP` | `false`, `true` или URL Clean Pay WebApp |
| `REMNAWAVE_HOST` | Hostname Remnawave без протокола |
| `REMNAWAVE_TOKEN` | API token Remnawave для Remnashop |
| `REMNAWAVE_WEBHOOK_SECRET` | Должен совпадать с Remnawave `WEBHOOK_SECRET_HEADER` |
| `DATABASE_PASSWORD` | Пароль базы Remnashop |

## 4. Remnawave

Проверить в Remnawave:

| Настройка | Ожидаемое значение |
| --- | --- |
| API token | Создан для Clean Pay и записан в Clean Pay `REMNAWAVE_TOKEN` |
| `WEBHOOK_ENABLED` | `true`, если Remnashop получает события Remnawave |
| `WEBHOOK_URL` | `https://bot.example.com/api/v1/remnawave` |
| `WEBHOOK_SECRET_HEADER` | Совпадает с Remnashop `REMNAWAVE_WEBHOOK_SECRET` |
| `FRONT_END_DOMAIN` | Домен панели, например `panel.example.com` |
| `SUB_PUBLIC_DOMAIN` | Например `panel.example.com/api/sub` |
| `PANEL_DOMAIN` | Например `panel.example.com` |

## 5. Запуск И Проверка

Запуск:

```bash
sh start.sh
```

Проверки:

```bash
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml ps
docker compose --env-file deploy/prod/.env -f deploy/prod/docker-compose.yml logs -f app
```

Health endpoint:

```text
http://127.0.0.1:4000/api/health
```

Ожидаемое поведение:

- Clean Pay стартует без ручного `docker network create`.
- Если Remnawave не отдаёт live subscription link, Clean Pay показывает явную ошибку.
- Ссылки подключения не берутся из cached Remnashop URL.
