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
- Поля текущей подписки показываем удобно на усмотрение Codex.
- VPN-ссылку показываем как две кнопки: "Подключиться" и "Скопировать ссылку подписки".
- Показываем traffic usage и любую другую информацию, которую отдаёт Remnashop.

## Перед шагом 11
- Управление устройствами обязательно: удалить одно устройство и удалить все.
- Перевыпуск подписки обязателен, с предупреждением что отключатся все устройства.
- Ввод промокода в кабинете нужен.

## Перед шагом 12
- Возвращаемся к плану: шаг 12 — профиль пользователя.
- `/profile` делаем отдельной страницей, из кабинета добавляем переход.
- Смена e-mail и пароля идут через Remnashop `/auth/email/change` и `/auth/change-password`.
- По коду Remnashop public API нет endpoint для смены имени, имя показываем read-only.

## Перед шагом 13
- Шаг 13 по плану — отдельная страница поддержки.
- Блок/страница поддержки должны быть отключаемыми.
- Контакты: support e-mail, Telegram username, FAQ URL.

## После шага 13
- Отдельная страница `/support` нужна и должна считаться частью шага 13.
- Текущий frontend признан неправильным по UI/UX: это временный Tailwind-макет, не production dashboard.
- Frontend нужно полностью переделать: общая навигация, layout, формы, состояния, dashboard/cabinet, responsive UX, единые компоненты реальной UI-библиотеки.
- Направление shadcn/ui отменено, итоговый UI-kit для этой переделки — PrimeReact.

## Текущее решение по frontend
- Работаем не по shadcn/ui: это направление отменено.
- Полностью переделываем UI/UX на PrimeReact как реальной UI-библиотеке: https://primereact.org/
- PrimeReact уже выбран как основной frontend UI-kit для проекта.
- Источник общего дизайна и layout-паттернов — локальный шаблон PrimeReact Sakai: `primereact-sakai-template`.
- UI Clean Pay нужно конструировать в стиле Sakai строго из физически перенесенных Sakai layout/styles/types/assets и реальных компонентов PrimeReact.
- Исходная папка `primereact-sakai-template` удалена после физического переноса; runtime должен зависеть только от `src/layout`, `src/styles/layout`, `src/types`, `public/layout`, `public/themes`.
- Никаких самодельных UI-kit блоков, кастомного shell/sidebar/topbar/cards как дизайн-системы быть не должно.
- Допустимы только тонкие архитектурные адаптеры для подключения бизнес-логики; визуальная структура должна оставаться Sakai/PrimeReact.
- Нужно использовать реальные компоненты PrimeReact, а не самописные аналоги: Button, InputText, Password, Dropdown, Message, Tag, DataTable, ProgressBar, Menu/PanelMenu, Toast/Dialog/ConfirmDialog по необходимости.
- Dashboard/cabinet нужно конструировать по Sakai dashboard/admin template-подходу, не собирать всё с нуля на div/className.
- PrimeReact Sakai-переделка frontend считается выполненной и является актуальной базой проекта.
- Шаг 14 можно начинать от текущего состояния: единая обработка ошибок во всём web-кабинете.

## Mock режим
- Normal server: `npm run start:normal` на порту 4000.
- Mock server: `npm run start:mock` на порту 4001.
- Mock BFF включается флагом `CLEAN_PAY_MOCK_MODE=1`.
- Mock режим нужен для frontend-preview без Remnashop/DB-сессии; normal режим должен оставаться без mock-данных.

## Cloudflare Turnstile
- В план добавлена Cloudflare Turnstile защита для регистрации, входа, запроса/подтверждения e-mail-кода, Telegram login/link и привязки `tg_id`.
- Реальные Site key и Secret key не коммитим; используем env: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_ENABLED`.
- BFF должен валидировать Turnstile token на сервере до обращения к Remnashop или создания web-сессии.

## Актуализация перед шагом 14
- Текущее состояние проекта принимаем как актуальное, без отката к старому Tailwind/shadcn-направлению.
- Шаги 1-13 считаются закрытыми в текущей реализации.
- Frontend на PrimeReact Sakai уже считается частью сделанной базы, несмотря на исходный номер шага 17 в плане.
- `/support` засчитывается как реализованная страница шага 13.
- Управление устройствами сейчас находится в `/cabinet`; отдельный `/devices` можно сделать позже, если потребуется.
- Следующий активный этап: вопросы перед шагом 14 и реализация единой обработки ошибок.

## Ответы перед шагом 14
- В production ошибки авторизации и другие чувствительные ошибки показываем максимально нейтрально.
- В development показываем расширенную диагностику.
- В development дополнительно показываем raw-ошибку от Remnashop/upstream, если она есть.
- В production пользователь не должен видеть или знать, что внутри используется Remnashop.

## Ответы перед шагом 14
- В production ошибки авторизации и другие чувствительные ошибки показываем максимально нейтрально.
- В development показываем расширенную диагностику.
- В development дополнительно показываем raw-ошибку от внешнего API, если она есть.
- В production пользователь не должен видеть или знать, что внутри используется Remnashop.

## После шага 14
- Добавлена единая серверная модель BFF-ошибок с production-сообщениями и development-debug.
- BFF в production отдаёт нейтральные пользовательские сообщения без упоминания Remnashop.
- BFF в development отдаёт error.debug с raw upstream detail/status/path.
- Клиентские компоненты читают BFF-ошибки через общий helper eadBffError.
- Пользовательские тексты больше не упоминают Remnashop.
