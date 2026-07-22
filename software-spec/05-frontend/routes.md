# Маршруты пользовательского интерфейса

| ID | Маршрут | Оболочка | Заголовок/назначение | Карточка |
|---|---|---|---|---|
| PAGE-001 | `/` | App | главная и action cards | `pages/PAGE-001.md` |
| PAGE-002 | `/login` | Auth | Вход | `pages/PAGE-002.md` |
| PAGE-003 | `/register` | Auth | Регистрация | `pages/PAGE-003.md` |
| PAGE-004 | `/register/verify-email` | Auth | завершение регистрации, 6 цифр | `pages/PAGE-004.md` |
| PAGE-005 | `/verify-email` | App | подтверждение e-mail существующей сессии | `pages/PAGE-005.md` |
| PAGE-006 | `/auth/telegram/webapp` | Auth | вход из Telegram WebApp | `pages/PAGE-006.md` |
| PAGE-007 | `/passkey/setup` | Auth | Быстрый вход | `pages/PAGE-007.md` |
| PAGE-008 | `/cabinet` | App | Личный кабинет | `pages/PAGE-008.md` |
| PAGE-009 | `/tariffs` | App | Тарифы | `pages/PAGE-009.md` |
| PAGE-010 | `/payment` | App | Подтверждение оплаты | `pages/PAGE-010.md` |
| PAGE-011 | `/extend` | App | Продление подписки | `pages/PAGE-011.md` |
| PAGE-012 | `/payment/success` | App | проверяемый возврат, success hint | `pages/PAGE-012.md` |
| PAGE-013 | `/payment/fail` | App | проверяемый возврат, fail hint | `pages/PAGE-013.md` |
| PAGE-014 | `/payment/pending` | App | проверяемый возврат, pending hint | `pages/PAGE-014.md` |
| PAGE-015 | `/profile` | App | Профиль | `pages/PAGE-015.md` |
| PAGE-016 | `/link-account` | App | Способы входа и merge | `pages/PAGE-016.md` |
| PAGE-017 | `/support` | App | Поддержка | `pages/PAGE-017.md` |
| PAGE-018 | `/install` | Auth | Установить Clean Pay | `pages/PAGE-018.md` |
| PAGE-019 | `/offline` | Auth | Нет подключения | `pages/PAGE-019.md` |

Совместимость query: вход/WebApp используют безопасный `redirect_to`; выбор оплаты и страницы возврата принимают псевдонимы из `api-usage.md`. Защитные redirect и доступ заданы в `permissions.md` и PAGE-карточках.
