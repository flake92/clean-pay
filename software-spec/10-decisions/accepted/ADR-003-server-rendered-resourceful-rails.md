# ADR-003: server-rendered resourceful Rails

## Статус

Принято пользователем 2026-07-23. Решение заменяет прежний BFF/JSON transport
baseline и требует полного повторного verification cycle.

## Контекст

Историческая спецификация фиксировала технические маршруты `/api/bff`, JSON
envelopes и compatibility aliases удалённого приложения. Для нового Ruby on
Rails монолита эти детали создавали ложную границу отдельного API/BFF.

Ценными остаются пользовательские входные данные, доменные инварианты,
результаты сценариев и внешние Remnashop/Telegram/Remnawave/Redis/SMTP
контракты. Исторические внутренние URL ценностью не являются.

## Решение

1. Браузер обращается непосредственно к одному Rails application.
2. Обычные пользовательские операции используют resourceful routes,
   `form_with`, strong parameters, Action View, redirects, flash и Turbo.
3. Namespace `/api/bff` и aliases `/api/me`, `/api/logout` не реализуются.
4. JSON остаётся только для WebAuthn browser protocol, health/internal machine
   interfaces и service-worker metadata.
5. Rails сам рендерит все 19 пользовательских страниц; Stimulus используется
   только для browser-only возможностей.
6. Outbound paths и wire contracts сохранённых интеграционных контейнеров не
   меняются.
7. Rails CSRF и origin protection заменяют собственный browser-mutation guard.

## Последствия

- HTTP-039/040 сняты и поглощены единственным `/account/session`.
- Реестр содержит 42 канонические входные операции.
- Карточки HTTP меняют JSON results на HTML/Turbo render/redirect там, где это
  пользовательская операция.
- Все доказательства реализации, включая ранее зелёные этапы 1–2, сброшены и
  должны быть получены заново после завершения re-baseline.
- Исторические файлы `09-traceability/source-*` остаются доказательством
  удалённого приложения и не описывают целевое дерево Rails.
