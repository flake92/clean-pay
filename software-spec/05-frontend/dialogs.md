# Диалоги и подтверждения

- Install embedded-browser dialog: explains opening external browser; button `Понятно`.
- Android install fallback dialog: browser menu/home screen guidance; `Понятно`.
- iOS install modal (`aria-modal`, labelled): three illustrated Safari steps, close icon `Закрыть инструкцию`, final `Понятно`.
- Account merge is an inline high-severity confirmation panel, not browser confirm: `Объединить аккаунты` and `Отмена`, both disabled during action.
- Destructive device/reissue/passkey actions currently execute from buttons without separate confirmation modal; loading disables the target. This absence is compatibility behavior.

Геометрия, точные подписи, состояния фокуса и mobile-раскладка зафиксированы в соответствующих карточках экранов и эталонных снимках `reference/current/`.
