# Паритет пользовательских возможностей с `main`

## Назначение финального gate

Этот документ фиксирует продуктовый, а не технологический паритет. Источник сравнения — дерево ветки `main` в commit `50b36e926a540394add87c3ae093a355fc370b0c`, прочитанное без переключения рабочей ветки командами `git ls-tree` и `git show`.

Паритет означает: пользователь с теми же исходными данными и состоянием может выполнить то же осмысленное действие, получить тот же бизнес-результат и увидеть управляемое успешное, пустое или ошибочное состояние. JWT, BFF, Next.js, JSON-envelope, имена внутренних endpoint-ов, язык, framework и способ хранения сессии не являются пользовательскими возможностями и намеренно не сравниваются.

Наличие строки недостаточно для прохождения gate. Строка получает итог `ДА` только после успешного единого финального цикла, включающего указанное исполняемое доказательство.

## Матрица

| ID | Наблюдаемая возможность в `main` | Источник в `main` | Нормативный контракт | Rails-путь пользователя | Исполняемое доказательство | Итог |
|---|---|---|---|---|---|---|
| MCU-001 | Открыть публичную главную и перейти ко входу, тарифам, кабинету, профилю, связыванию или поддержке | `src/app/page.tsx`, layout | PAGE-001, navigation | `GET /` и ссылки AppShell | `page_001_test.rb`, visual PAGE-001 | ДА — cycle 3 |
| MCU-002 | Ввести e-mail и получить правильный следующий шаг: вход либо регистрация | `auth-forms.tsx`, identify BFF | CAP-01, HTTP-001, PAGE-002 | `POST /account/identity` | `http_001_test.rb`, `page_002_test.rb` | ДА — cycle 3 |
| MCU-003 | Зарегистрироваться по e-mail и паролю с проверкой совпадения/длины и антибот-защитой | `auth-forms.tsx`, register BFF | CAP-02, HTTP-003, HTTP-011, TS-000/001, PAGE-003 | `POST /account/registration` | `http_003_test.rb`, `http_011_test.rb`, `page_003_test.rb`, Turnstile contract | ДА — cycle 3 |
| MCU-004 | Войти существующим e-mail и паролем; неверные данные дают управляемую ошибку | `auth-forms.tsx`, login BFF | CAP-02, HTTP-002, PAGE-002 | `POST /account/session` | `http_002_test.rb`, email purchase journey | ДА — cycle 3 |
| MCU-005 | Получить письмо с шестизначным кодом, повторно отправить код, подтвердить адрес и вернуться назад с очисткой bootstrap-сессии | `register-email-confirm-form.tsx` | CAP-03, HTTP-005/007/008, MAIL-001/002, PAGE-004 | registration → `/register/verify-email` | `http_005_test.rb`, `http_007_test.rb`, `http_008_test.rb`, email purchase journey, Mailpit contract | ДА — cycle 3 |
| MCU-006 | Подтвердить или повторно подтвердить e-mail существующего аккаунта | `verify-email-panel.tsx` | CAP-03, HTTP-007/008, PAGE-005 | `/verify-email` forms | `page_005_test.rb`, `http_007_test.rb`, `http_008_test.rb` | ДА — cycle 3 |
| MCU-007 | Войти через Telegram OIDC и безопасно вернуться на запрошенную страницу; отказ не создаёт сессию | `TelegramLoginButton`, Telegram start/callback | CAP-04, HTTP-041/042, TG-001…003 | `/account/telegram_authorization/new` → callback | `http_041_test.rb`, `http_042_test.rb`, Telegram OIDC contract | ДА — cycle 3 |
| MCU-008 | Войти из Telegram WebApp по подписанному `initData` с безопасным fallback | Telegram WebApp page/BFF | CAP-04, HTTP-016, TG-006, PAGE-006 | `/auth/telegram/webapp` | `http_016_test.rb`, `page_006_test.rb` | ДА — cycle 3 |
| MCU-009 | Войти Telegram Login Widget и отклонить испорченную/устаревшую подпись | Telegram auth boundary | CAP-04, HTTP-043, TG-004/005 | signed form callback | `http_043_test.rb`, Telegram payload tests | ДА — cycle 3 |
| MCU-010 | Войти быстрым ключом устройства; отмена WebAuthn остаётся управляемым состоянием | `PasskeyLoginButton` | CAP-05, HTTP-012/013, PAGE-002 | passkey session options/verify | `http_012_test.rb`, `http_013_test.rb`, passkey ceremony test | ДА — cycle 3 |
| MCU-011 | Настроить необязательный быстрый вход или продолжить без него | `PasskeySetup` | CAP-05, HTTP-010/011, PAGE-007 | `/passkey/setup` | `page_007_test.rb`, passkey ceremony test | ДА — cycle 3 |
| MCU-012 | Просмотреть ключи доступа и удалить любой, кроме последнего | passkey credentials UI | CAP-05, HTTP-014/015 | `/account/passkeys` | `http_014_test.rb`, `http_015_test.rb`, credential test | ДА — cycle 3 |
| MCU-013 | Выйти и отозвать пользовательскую сессию без сохранения приватного состояния в браузере | cabinet logout | HTTP-005, navigation | `DELETE /account/session` | `http_005_test.rb`, email purchase journey | ДА — cycle 3 |
| MCU-014 | Просмотреть профиль: e-mail, способ входа, Telegram ID и статус подтверждения | `profile-panel.tsx` | HTTP-004, PAGE-015 | `GET /profile` | `http_004_test.rb`, `page_015_test.rb` | ДА — cycle 3 |
| MCU-015 | Изменить e-mail либо повторно запросить код; текущий адрес не подменяется до ответа | `profile-panel.tsx` | CAP-03, HTTP-007/009, MAIL-001/003, PAGE-015 | profile e-mail forms | `http_007_test.rb`, `http_009_test.rb`, `page_015_test.rb`, Mailpit contract | ДА — cycle 3 |
| MCU-016 | Изменить пароль и отозвать соседние сессии | `profile-panel.tsx` | HTTP-006, PAGE-015 | `PUT /account/password` | `http_006_test.rb`, session authenticator test | ДА — cycle 3 |
| MCU-017 | Привязать e-mail/Remnashop-владельца к Telegram-only аккаунту | `link-account-panel.tsx` | CAP-06, HTTP-020, PAGE-016 | `POST /account/remnashop_link` | `http_020_test.rb`, Telegram merge journey | ДА — cycle 3 |
| MCU-018 | Привязать Telegram к текущему аккаунту | `link-account-panel.tsx` | CAP-04/06, HTTP-041…043, PAGE-016 | Telegram authorization from `/link-account` | Telegram merge journey, Telegram contracts | ДА — cycle 3 |
| MCU-019 | При конфликте владельцев увидеть маскированные стороны и явно подтвердить или отменить объединение | link flow and conflict response | CAP-06, HTTP-017…020, PAGE-016 | merge confirmation resource | `http_017_test.rb`…`http_020_test.rb`, Telegram merge journey | ДА — cycle 3 |
| MCU-020 | Открыть каталог тарифов, увидеть длительности, цены и gateways и сохранить точный выбор | `tariffs-panel.tsx` | CAP-07, HTTP-021/023, PAGE-009 | `/tariffs` → `/payment?...` | `http_021_test.rb`, `http_023_test.rb`, `page_009_test.rb` | ДА — cycle 3 |
| MCU-021 | Увидеть пустой/недоступный каталог и требование войти/привязать e-mail без 500 | `tariffs-panel.tsx`, `AccountActionRequired` | PAGE-009 screen states, error contracts | `/tariffs` guarded states | `page_009_test.rb`, request error tests | ДА — cycle 3 |
| MCU-022 | Проверить сервером выбранное предложение, изменить выбор либо один раз перейти к оплате | `payment-confirmation.tsx` | CAP-09, HTTP-024, PAGE-010 | `/payment` → `POST /purchases` | `http_024_test.rb`, `page_010_test.rb`, email purchase journey | ДА — cycle 3 |
| MCU-023 | Увидеть текущую подписку, срок, статус, лимиты трафика/устройств и live-ссылку подключения | `cabinet-panel.tsx` | CAP-08, HTTP-022, PAGE-008 | `/cabinet`, `/subscription` | `http_022_test.rb`, `page_008_test.rb`, subscription journey | ДА — cycle 3 |
| MCU-024 | Открыть либо скопировать live-ссылку подключения с управляемой ошибкой clipboard | `cabinet-panel.tsx` | CAP-08, BR-002, PAGE-008 | cabinet subscription actions | subscription journey | ДА — cycle 3 |
| MCU-025 | Просмотреть устройства, удалить одно или все после подтверждения | `cabinet-panel.tsx` | CAP-08, HTTP-028…030 | devices resource | `http_028_test.rb`…`http_030_test.rb`, subscription journey | ДА — cycle 3 |
| MCU-026 | Перевыпустить подписку с явным предупреждением об отключении устройств | `cabinet-panel.tsx` | CAP-08, HTTP-026 | `POST /subscription/reissue` | `http_026_test.rb`, subscription journey | ДА — cycle 3 |
| MCU-027 | Активировать промокод и увидеть награду либо управляемую ошибку | `cabinet-panel.tsx` | CAP-08, HTTP-027 | `POST /subscription/promocode` | `http_027_test.rb`, subscription journey | ДА — cycle 3 |
| MCU-028 | При отсутствии подписки перейти к тарифам/связыванию, а не увидеть сломанный кабинет | `cabinet-panel.tsx` empty state | PAGE-008 | `/cabinet` empty subscription | `page_008_test.rb` | ДА — cycle 3 |
| MCU-029 | Выбрать подтверждённое предложение продления либо получить понятное отсутствие активной подписки | `extend-confirmation.tsx` | CAP-09, HTTP-025, PAGE-011 | `/extend` → `POST /extensions` | `http_025_test.rb`, `page_011_test.rb`, subscription journey | ДА — cycle 3 |
| MCU-030 | Просмотреть свою историю платежей без данных другого владельца | cabinet payment table | CAP-10, HTTP-031, PAGE-008 | `/payments`, cabinet history | `http_031_test.rb`, payment model tests | ДА — cycle 3 |
| MCU-031 | После возврата провайдера увидеть серверный success/fail/pending, а не доверять query-подсказке | `payment-return-status.tsx` | CAP-10, HTTP-032, PAGE-012…014 | `/payment/{success,fail,pending}` | `http_032_test.rb`, `page_012_test.rb`…`page_014_test.rb`, email purchase journey | ДА — cycle 3 |
| MCU-032 | Открыть опубликованные e-mail, Telegram и FAQ поддержки; отсутствующие каналы не показываются | `support-panel.tsx` | CAP-11, HTTP-033, SUP-001…003, PAGE-017 | `/support` | `http_033_test.rb`, `page_017_test.rb` | ДА — cycle 3 |
| MCU-033 | Прочитать пошаговую инструкцию подключения и назначение web-кабинета | `support-panel.tsx` cards «Как подключиться», «Для кого этот сайт» | PAGE-017 introductory/help content | `/support` instructional cards | `page_017_test.rb` | ДА — cycle 3 |

## Результат cycle 3

- локальная ветка `main` повторно разрешена в
  `50b36e926a540394add87c3ae093a355fc370b0c`; это тот же commit, по которому
  составлена матрица;
- `bin/ci`: 173 runs, 842 assertions, 0 failures, 0 errors, 0 skips;
- HTTP: 53 runs, 281 assertions;
- внешние интеграции: 30 runs, 135 assertions и реальный readiness
  PostgreSQL/Redis/Remnashop/Telegram/Remnawave/Mailpit — 6 из 6 `ok`;
- конкурентность: 5 runs, 23 assertions;
- system/E2E: 26 runs, 184 assertions;
- визуальный контракт: 19 desktop + 19 mobile сцен, 38 из 38 `PASS`,
  минимальная схожесть 89,27% при пороге 88%.

Каждая строка MCU-001…033 подтверждена хотя бы одним тестом наблюдаемого
пользовательского результата; для возможностей с внешним эффектом дополнительно
подтверждён соответствующий внешний интерфейс. Технологическая реализация
сессии, transport и внутреннее разбиение Rails не использовались как критерий
паритета.

## Допустимое расширение относительно `main`

Rails-приложение дополнительно предоставляет PAGE-018/PAGE-019: установку PWA, обновление и privacy-safe offline fallback. Это расширение не заменяет и не ослабляет ни одну строку MCU-001…033.

## Финальная процедура GATE-015

1. Зафиксировать hash локальной `main` и повторить read-only inventory страниц, controls, BFF business operations и E2E assertions.
2. Проверить, что каждая обнаруженная наблюдаемая возможность присутствует отдельной строкой MCU; объединять разные пользовательские результаты ради уменьшения таблицы нельзя.
3. Для каждой строки проверить полную цепочку: исходное состояние → видимый control → Rails request → доменная операция → внешний контракт при наличии → устойчивое изменение → видимый результат/ошибка.
4. Запустить все указанные доказательства в одном финальном cycle. Старый успешный запуск или наличие файла не считается доказательством.
5. Сверить desktop/mobile UI с эталонами и отдельно проверить смысловой текст/controls, которые pixel similarity может пропустить.
6. Убедиться, что ни один итог не содержит `ОЖИДАЕТ`, `В РАБОТЕ`, `НЕТ`, `TODO`, `SKIP` или пустую ячейку.
7. Только после этого заменить все итоги на `ДА — cycle <номер>` и выставить GATE-015 положительный статус в `TECHNICAL_IMPLEMENTATION_PLAN.md`.

Если хотя бы одна возможность `main` отсутствует, имеет другой бизнес-результат или не имеет исполняемого доказательства, GATE-015 не пройден и приложение не считается готовым к замене прежней реализации.
