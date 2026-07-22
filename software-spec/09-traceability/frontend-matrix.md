# Матрица пользовательского интерфейса

Все элементы имеют статус `описан`. Маршруты, элементы управления, состояния и цепочки API разнесены по карточкам `05-frontend/pages/`, общим UI-документам и автономному макету. Для каждой PAGE существуют проверенные current и mockup снимки desktop/mobile.

| ID | Источники | Спецификация | Эталон/макет | Статус |
|---|---|---|---|---|
| PAGE-001…019 | все страницы, layout, маршрутизация и UI-тесты | `routes.md`, `screens.md`, 19 карточек PAGE | 38 current + 38 mockup снимков, checksums | описан и отрендерен |
| FORM-001 | формы определения/входа/регистрации | `forms.md`, journeys, HTTP-001—003 | PAGE-002/003 | описан и E2E-проверен |
| FORM-002 | панели запроса/подтверждения почты | forms, states, HTTP-007—009 | PAGE-004/005 | описан и SMTP/E2E-проверен |
| FORM-003 | профиль | forms, PAGE-015, HTTP-004/006/009 | PAGE-015 | описан |
| FORM-004 | Passkey | forms/dialogs, HTTP-010—015 | PAGE-007/016 | описан и concurrency-проверен |
| FORM-005 | Telegram OIDC/WebApp/widget | journeys, HTTP-016/041—043 | PAGE-002/006/016 | описан и E2E-проверен |
| FORM-006 | link/merge | dialogs/journeys, HTTP-017—020 | PAGE-016 | описан и PostgreSQL-проверен |
| FORM-007 | тариф/покупка/продление | forms/journeys, HTTP-021/023—025 | PAGE-009/010/011 | описан и mock-E2E-проверен |
| FORM-008 | действия кабинета | screens/forms, HTTP-026—030 | PAGE-008 | описан и E2E-проверен |
| FORM-009 | возврат и polling платежа | states/API usage, HTTP-032 | PAGE-012/013/014 | описан и E2E-проверен |
| FORM-010 | установка/PWA/инструкции | dialogs/journeys, HTTP-044 | PAGE-018/019 | описан и browser-render проверен |
| UI-COMP-ALL | компоненты, layout, styles, assets | components/navigation/current inventory/design tokens | общая оболочка всех сцен | описан |
| UI-STATE-ALL | состояния/effects/helpers/frontend tests | screen-states и PAGE-карточки | loading/empty/error/success/disabled/responsive | описан |
