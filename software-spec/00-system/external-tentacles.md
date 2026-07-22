# Реестр внешних сервисов и инфраструктурных участников

## Производственный контур

| Участник | Прямой клиент | Транспорт | Роль |
|---|---|---|---|
| Reverse proxy / HTTPS-терминатор | браузер и оператор | HTTPS с передачей запроса в Clean Pay по HTTP | публикует приложение; может находиться на хосте или во внешней Docker-сети |
| PostgreSQL Clean Pay | Clean Pay и процесс очистки | протокол PostgreSQL | хранит собственное долговечное состояние |
| Redis Clean Pay | Clean Pay | RESP поверх TCP | ограничение частоты и общий кэш готовности |
| Remnashop public API | Clean Pay | JSON/HTTP(S) и auth-cookie Remnashop | пользовательские учётные данные, профиль, планы, подписка, устройства, платежи |
| Remnashop admin API | Clean Pay | JSON/HTTP(S), `x-api-key` | объединение пользователей и фоновая сверка платежных операций |
| Remnawave API | Clean Pay и отдельно Remnashop | JSON/HTTP(S), Bearer-токен | авторитетное состояние VPN-подписки и живая ссылка |
| Telegram OIDC | браузер и Clean Pay | OAuth 2.0/OIDC, PKCE, JWT/JWKS | проверенная Telegram-идентичность |
| Telegram Bot API | Remnashop | Telegram Bot HTTP API | бот и Telegram WebApp-контур; Clean Pay напрямую Bot API не вызывает |
| Cloudflare Turnstile | браузер и Clean Pay | виджет в браузере и form-encoded HTTP POST проверки | антибот-защита чувствительных операций |
| SMTP-провайдер | Remnashop | SMTP с настраиваемыми TLS/SSL и учётными данными | доставка кода подтверждения e-mail |
| Почтовый ящик пользователя | SMTP-провайдер | почтовая доставка | получение одноразового кода |
| Платёжный провайдер | Remnashop и браузер | точный API провайдера находится за границей Remnashop; браузер получает HTTP(S) `payment_url` | приём платежа; Clean Pay напрямую API провайдера не вызывает |
| Системные API браузера | клиентский интерфейс | WebAuthn, Clipboard, Storage, Service Worker, Cache API, установка PWA | ключи доступа, копирование ссылки, платёжная корреляция и автономная оболочка |
| Планировщик сверки | внутренний worker Clean Pay | защищённый HTTP POST | запускает пакетную сверку неоднозначных платежей |
| Процесс очистки | PostgreSQL Clean Pay | SQL | периодически удаляет только истёкшие служебные данные |
| Оператор | Compose, приложение, БД | CLI, HTTP health, резервные копии | развёртывание и эксплуатация |

## Контейнеры среды разработки и тестирования

| Контейнер | Что заменяет или обслуживает | Данные/порты |
|---|---|---|
| `app` | текущая реализация Clean Pay и рабочее dev-окружение | 4000; 5555 для инструмента просмотра БД |
| `postgres` | PostgreSQL Clean Pay | 5432, отдельный именованный том |
| `redis` | Redis Clean Pay | 6379, AOF, отдельный именованный том |
| `remnashop` | зафиксированная совместимая версия HTTP-сервиса Remnashop | внутренний 5000, хост 5001 |
| `remnashop-worker` | фоновые задачи Remnashop | тот же образ и конфигурация Remnashop |
| `remnashop-scheduler` | расписание задач Remnashop | тот же образ и конфигурация Remnashop |
| `remnashop-postgres` | собственная БД Remnashop | внутренний 5432, хост 6767, отдельный том |
| `remnashop-cache` | собственный Valkey Remnashop | внутренний 6379, AOF, отдельный том |
| `remnawave-mock` | минимальная тестовая замена Remnawave | внутренний 3000 |
| `telegram-mock` | тестовая замена Telegram Bot API для Remnashop | внутренний 8080 |
| `telegram-oidc-mock` | тестовая замена Telegram OIDC | 8090; authorization, token, JWKS, discovery и avatar |
| `smtp` | Mailpit: тестовый SMTP-приёмник и HTTP-интерфейс почтового ящика | SMTP 1025, HTTP 8025 |
| `smtp-log` | наблюдатель за письмами Mailpit | принимает webhook на 8126 и читает сообщения через Mailpit API |
| `caddy` | локальный reverse proxy | 8080 → Clean Pay, 8081 → Remnashop, 8026 → Mailpit |

## Производственные контейнеры Clean Pay

Производственный Compose определяет `app`, `postgres`, `redis`, постоянно работающий `retention-worker` и опциональный по профилю `reconciliation-worker`. Remnashop, его worker/scheduler, SMTP, Telegram, Remnawave, платёжный провайдер и reverse proxy в этот Compose не входят: они являются внешним окружением. `app` может присоединяться к существующей edge-сети под псевдонимом `clean-pay`.

## Зависимости сборки и CI, не являющиеся функциями времени выполнения

| Внешний ресурс | Когда используется | Назначение |
|---|---|---|
| GitHub repository Clean Pay | clone/pull/CI | доставка исходного проекта до будущего удаления |
| GitHub Actions | push/pull request | lint, typecheck, unit, build и PostgreSQL concurrency checks |
| GitHub repository Remnashop на точном commit | сборка dev integration image | воспроизводимый совместимый Remnashop |
| npm registry | `npm ci` при build/dev/CI | зафиксированные JavaScript dependencies |
| Реестры контейнерных образов | сборка/deploy/test | базовые образы текущего приложения, PostgreSQL, Redis/Valkey, Caddy, Mailpit и среды разработки |
| Репозиторий пакетов Docker | сборка среды разработки | Docker CLI внутри тестовой/development среды |

Эти ресурсы влияют на воспроизводимость сборки и тестов, но не являются пользовательскими runtime-интерфейсами Clean Pay. Будущий базовый prestage должен либо сохранить эквивалентные обязанности, либо явно заменить их.

## Правило сохранения после будущей очистки

Этот документ не является разрешением на удаление. Перед будущим удалением требуется отдельная проверка, какие контейнеры являются реализацией Clean Pay, а какие — спецификационной или интеграционной тестовой инфраструктурой. Контейнеры, сети и тома нельзя удалять или останавливать без явного перечня и подтверждения пользователя.
