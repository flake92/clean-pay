# Использование Rails-входов интерфейсом

| Область UI | Rails resources/forms/protocol operations |
|---|---|
| global menu/header | auth/me, subscription/offers, auth/logout |
| auth | identify, login/register, passkey login options/verify, Telegram start |
| verification/profile | auth/me, email request/confirm/change, password change |
| passkey/link | register options/verify, credential list/delete, Remnashop link, merge GET/POST/DELETE, Telegram start |
| cabinet | current, devices GET/DELETE, reissue, promo, offers, payment history, support, logout |
| tariffs/payment/extend | offers; purchase or extend |
| returns | payment status polling |
| support | support |
| WebApp | Telegram webapp |

URL страницы оплаты принимает ключи выбора, сформированные карточками тарифов, но сервер повторно находит точное предложение и подписывает submission token. Страницы возврата принимают внешние псевдонимы `payment_id|paymentId|order_id|id` и `operation_id|operationId`, затем owner-scoped Rails query находит долговечную локальную операцию. Идемпотентность хранится на сервере; браузер не является владельцем ключа и не обязан сохранять платёжные данные в storage.
