# Состояния экранов

Каждая панель данных обязана различать четыре базовых состояния: первоначальная загрузка, успешная загрузка без данных, успешная загрузка с данными и ошибка. Empty не изображается как error; error не заменяется пустой таблицей. Конкретные ветви перечислены в PAGE-карточках.

Во время мутации хранится ровно одно состояние выполняемого действия: повторный click заблокирован, label или spinner сообщает ход операции, несвязанные панели остаются доступны. После результата фокус переносится к Message или первому invalid field. Severity: `info`, `success`, `warn`, `error`; доменный status показывается Tag. Публичный текст Rails form/flash имеет приоритет, иначе используется заранее определённый русский fallback. Неизвестный server status выводится как неизвестный и никогда не превращается в успех.

Особые машины состояний:

- Payment return продолжает bounded polling при retryable operation и при временной сетевой ошибке только с известным durable reference; server retry seconds учитываются.
- Merge: отсутствует → ожидает решения → подтверждается/отменяется → terminal/error; evidence одноразово.
- E-mail verification: unverified → request/confirm → already verified либо account-sync-pending → verified.
- PWA: detecting → installable/embedded/iOS/Android fallback/already installed; отдельно offline и update available.
- Passkey: options → native prompt → verify → success/cancel/error; cancel оставляет альтернативный вход.
