# Обратный прокси и HTTPS-граница

## Назначение

Production-приложение слушает loopback host port и предполагает публикацию через внешний HTTPS-терминатор. Proxy может работать на хосте либо во внешней Docker edge-сети и обращаться к alias `clean-pay:4000`.

## Входной интерфейс

Proxy пересылает HTTP-запрос без переименования path, query, method, headers, cookies и body. Публичный origin обязан совпадать в `APP_URL` и `NEXT_PUBLIC_APP_URL` и использовать HTTPS. HSTS выставляет реальный HTTPS-терминатор; остальные security headers формирует Clean Pay.

## Доверенные forwarding-данные

| Header | Использование |
|---|---|
| `Host` | диагностика callback и origin |
| `X-Forwarded-Host` | диагностика Telegram callback |
| `X-Forwarded-Proto` | диагностика публичного protocol |
| `X-Forwarded-Port` | диагностика порта |
| `X-Forwarded-For` | только правый крайний валидный IP используется для Turnstile; сам header должен перезаписываться/дополняться доверенным proxy |
| `X-Real-IP` | только диагностический признак, не источник Turnstile IP |

Приложение нельзя публиковать напрямую в Internet при сохранении этой модели доверия. Production bind допускает только `127.0.0.1` или `::1`.

## Интерфейсы здоровья для прокси и оператора

- `GET /health/liveness` — жив ли процесс;
- `GET /health/readiness` — безопасная публичная готовность;
- подробный `GET /internal/health/readiness` доступен только внутри доверенной сети и требует `x-clean-pay-readiness-secret`.

## Прокси разработки и тестов

Контейнер Caddy предоставляет три независимых upstream:

- `:8080` → `app:4000`;
- `:8081` → `remnashop:5000`;
- `:8026` → `smtp:8025`.

Автоматический HTTPS в этом dev proxy отключён. Это тестовая топология и не определяет production TLS.
