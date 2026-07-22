# Формы и controls

| Form/action | Fields in order | Client constraints | Submit/loading/result |
|---|---|---|---|
| Login identify | E-mail | required, email input, trim/lower for state | Продолжить; loading disable → identify |
| Login known | summary email/Изменить; Пароль | required password | Продолжить → login; passkey button when available |
| Login unknown | summary; password; repeat | required, equality | Создать аккаунт → register |
| Register | E-mail; Пароль; Повторите пароль; Turnstile | email required, password feedback/equality | Зарегистрироваться disabled/loading |
| Registration confirm | Код | numeric input, maxLength 6, placeholder 000000 | confirm/resend/back share lock |
| Verify | Код; separate E-mail resend | code placeholder 000000; email input | separate confirm/request loading |
| Profile email | Новый e-mail; Turnstile | trim; same email becomes resend | Сохранить/verify redirect |
| Profile password | Текущий; Новый пароль | password inputs | Изменить пароль |
| Link email | E-mail; Пароль | required | Привязать e-mail |
| Passkey name | Название устройства | optional, max implied server 80 | Настроить быстрый вход/Продолжить без него |
| Tariff selection | duration+gateway dropdown per plan | one exact offer | Выбрать/Изменить тариф link |
| Payment confirmation | no editable field | URL/storage selection must match refreshed offer | Перейти к оплате disabled during request |
| Extend | duration+gateway dropdown | selected price required | Продлить disabled/loading |
| Promo | Промокод | input nonempty by browser/form logic | Активировать loading |

Токен Turnstile добавляется под обоими поддерживаемыми псевдонимами. Поле пароля имеет кнопку показать/скрыть с сохранением фокуса и значения. Сервер остаётся авторитетным; точная runtime-валидация задана HTTP-карточками, а порядок/подписи/states — карточками экранов.
