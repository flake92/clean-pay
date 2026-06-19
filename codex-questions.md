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
- Remnashop API contracts берём из https://github.com/snoups/remnashop.
- Remnashop tokens приходят через cookies `access_token` и `refresh_token`.
- Remnashop refresh token храним у нас encrypted, не отдаём frontend.
- Ошибки Remnashop нормализуем по первому практичному набору.

## Перед шагом 5
- Auto-refresh Remnashop access token нужен.
- Привязка e-mail <-> tg_id через отдельный экран, в обе стороны.
- Сразу делаем минимальные формы `/login`, `/register`, `/cabinet`, `/link-account`.

## Перед шагом 6
- SMTP prod должен настраиваться через env; тестовая почта есть, пароль не коммитим.
- Код отправляет Remnashop через `/auth/email/request-verification`.
- Наша защита: не чаще 1 раза в минуту.
- Текст письма нужен RU+EN, если будем отправлять сами.
- Код: 6 цифр.

## Перед шагом 7
- Тарифы показываем только авторизованным.
- Используем `/api/bff/subscription/offers`.
- Показываем все доступные gateway и пользователь выбирает сам.
- Нужен выбор длительности, количества устройств и отображение параметров тарифа.

## Перед шагом 8
- `/payment` делаем отдельным экраном подтверждения.
- После создания платежа сразу редиректим на `payment_url` Remnashop.
- Если `is_free: true`, ведём в `/cabinet`.

## Перед шагом 9
- Продление делаем аналогично Remnashop `/subscription/extend`.
- Варианты берём из `/api/bff/subscription/offers`.
- Если текущей подписки нет, отправляем на `/tariffs`.

## Перед шагом 10
- Какие поля текущей подписки показываем первыми в кабинете?
- VPN-ссылку показываем сразу как plain text + copy button?
- Нужно ли показывать traffic usage, если Remnashop отдаёт used bytes?
