# Использование API интерфейсом

| Область UI | Логические HTTP-операции |
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

URL страницы оплаты принимает ключи выбора, сформированные карточками тарифов. Страницы возврата принимают внешние псевдонимы `payment_id|paymentId|order_id|id` и `operation_id|operationId`, затем используют сохранённую долговечную ссылку. Браузерное хранилище сохраняет непрерывность идемпотентного ключа/операции/платежа и очищает либо заменяет их только после доказанного терминального результата или нового явно выбранного предложения.
