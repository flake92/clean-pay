# Codex working questions

Этот файл хранит короткие рабочие вопросы и решения для Codex.

## Общие
- Где взять актуальную OpenAPI/документацию Remnashop API и примеры ответов?
- Какие поля реально возвращают тарифы, подписка, покупка, продление и устройства?
- Кто отправляет e-mail-коды: Remnashop или web-кабинет?
- Нужна ли локальная регистрация имени пользователя или только e-mail/пароль?
- Какие платежные return URLs ожидает Remnashop?
- Какие контакты поддержки и инструкции показывать в кабинете?
- Есть ли брендовые материалы CleanVPN: логотип, цвета, тексты?
- Где будет production: сервер, Docker-сеть, доступ к Remnashop, домен, Cloudflare?
- Какие сценарии входят в MVP, а что можно оставить после MVP?

## Перед шагом 1
- App Router: да.
- Package manager: npm.
- Шаг 1: каркас приложения + Prisma ORM к нашей Postgres в devcontainer.
- Прямого взаимодействия с БД Remnashop не будет.

## Полученные ответы
- Документация Remnashop: https://github.com/snoups/remnashop
- E-mail-коды отправляет web-кабинет.
- Payment return URLs находятся на стороне web-кабинета.
- Брендовые материалы CleanVPN пока не определены.
- MVP не фиксируем заранее, идем по шагам.

## Перед шагом 2
- SMTP есть.
- Production `APP_URL`: `https://oplata.clear-vpn.org`.
- Remnashop public API: `https://bot2.clear-vpn.org/api/v1/public`.
- Payment return URLs собираем от `APP_URL`.

## Перед шагом 3
- E-mail verification codes храним в нашей БД.
- Code TTL: 15 минут.
- Max attempts: 5.
- Храним дату отправки.
- Web access session: 15 минут.
- Web refresh session: 30 дней.
- Audit logs нужны сразу с auth-сценариев.
- Вход возможен по e-mail или Telegram ID.

## Перед шагом 4
- Перед шагом 4 добавлен Telegram OIDC flow.
- Какой формат auth/register и auth/login в Remnashop API?
- Что Remnashop возвращает после login: access token, refresh token, user object?
- Нужно ли web-кабинету хранить Remnashop refresh token или каждый раз работать только через web session?
- Какие ошибки Remnashop нормализуем первыми?
