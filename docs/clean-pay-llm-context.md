# Контекст для LLM / разработчика: проект Clean Pay

## 1. Основная задача

Работаем с проектом **Clean Pay**.

Локальный путь проекта на машине разработчика:

```text
C:\code\clean-pay
```

Для проекта уже существуют:

- dev-контейнеры;
- тестовый стенд;
- смежные сервисы Remnawave и Remnashop.

Требуется поднять и настроить **Clean Pay** на тестовом стенде для домена:

```text
oplata.clear-vpn.org
```

Clean Pay должен использовать существующие сервисы Remnawave / Remnashop и не ломать уже работающую инфраструктуру.

---

## 2. Важные ограничения

1. Не менять рабочие сервисы без явного согласования.
2. Не выполнять destructive-операции без подтверждения.
3. Не менять структуру БД Remnashop / Remnawave.
4. Интеграцию делать через API и конфигурацию.
5. Не мешать будущим обновлениям Remnashop / Remnawave.
6. Перед изменением Caddy делать резервную копию конфига.
7. Все секреты из этого файла нельзя коммитить в Git.
8. Все `.env` файлы должны оставаться только на стенде или в локальном защищённом окружении.

---

## 3. Тестовый стенд

SSH-доступ:

```text
host: host1.clear-vpn.org
port: 6088
user: root
password: ***TestAdmin123*
```

Команда подключения:

```bash
ssh root@host1.clear-vpn.org -p 6088
```

На стенде уже подняты:

- Remnawave;
- Remnashop;
- Caddy.

Требуется дополнительно поднять:

- Clean Pay.

---

## 4. Caddy

На стенде уже работает Caddy.

Путь к конфигурационному файлу Caddy:

```text
/opt/remnawave/caddyCaddyfile
```

Перед изменениями обязательно проверить фактический путь. Возможные варианты для проверки:

```bash
ls -la /opt/remnawave/
find /opt/remnawave -iname '*Caddyfile*' -o -iname 'Caddyfile'
```

Перед правками сделать backup:

```bash
cp /opt/remnawave/caddyCaddyfile /opt/remnawave/caddyCaddyfile.bak.$(date +%F_%H-%M-%S)
```

Если фактический путь окажется другим, например `/opt/remnawave/caddy/Caddyfile`, backup делать для него.

Домен для Clean Pay:

```text
oplata.clear-vpn.org
```

Ожидаемый результат по Caddy:

- Caddy должен проксировать `https://oplata.clear-vpn.org` на локальный порт Clean Pay.
- Нельзя ломать существующие маршруты Remnawave / Remnashop.
- После изменения обязательно выполнить проверку конфига и reload.

Пример безопасной проверки:

```bash
caddy validate --config /path/to/Caddyfile
```

Reload выполнять только после успешной проверки.

---

## 5. Remnashop

Документация:

```text
https://remnashop.mintlify.app/docs/ru/overview/releases
```

Код:

```text
https://github.com/snoups/remnashop
```

На тестовом стенде Remnashop уже поднят.

Информацию о работающем боте и настройках можно искать в файле:

```text
/opt/remnashop/.env
```

Что проверить в Remnashop:

```bash
cd /opt/remnashop
ls -la
cat .env
```

Важно:

- Не менять БД Remnashop.
- Не ломать текущий бот.
- Использовать доступные API / env-переменные.
- Проверить, какие host/port реально использует Remnashop на стенде.

---

## 6. Remnawave

Документация:

```text
https://docs.rw
```

Код:

```text
https://github.com/remnawave
```

На тестовом стенде Remnawave уже поднят.

Информацию о настройках можно искать в файле:

```text
/opt/remnawave/.env
```

Что проверить:

```bash
cd /opt/remnawave
ls -la
cat .env
```

Важно:

- Не менять БД Remnawave.
- Не ломать панель Remnawave.
- Использовать API / env-переменные.
- Проверить реальные внутренние адреса и порты сервисов.

---

## 7. Clean Pay

Локальный путь проекта:

```text
C:\code\clean-pay
```

Требуется:

1. Поднять Clean Pay на тестовом стенде.
2. Подключить домен `oplata.clear-vpn.org` через Caddy.
3. Подключить Cloudflare Turnstile.
4. Подключить SMTP для отправки кодов / писем.
5. Подключить Telegram OIDC для авторизации через бота.
6. Использовать данные Remnashop / Remnawave из `.env` файлов на стенде.
7. Проверить авторизацию, оплату/подписку и работу пользовательского сценария.

---

## 8. Cloudflare Turnstile

Turnstile Widgets:

```text
0x4AAAAAADoKdZxToJ5aIq2U
0x4AAAAAADoKdSfYunPDRBkGgHDmgPqOdhc
```

Эти значения использовать как sitekey/widget key в конфигурации Clean Pay.

Нужно проверить, какое значение ожидает проект:

- `TURNSTILE_SITE_KEY`
- `CLOUDFLARE_TURNSTILE_SITE_KEY`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `VITE_TURNSTILE_SITE_KEY`
- и аналогичные переменные.

Важно:

- Secret key Turnstile в исходных данных не указан.
- Если backend требует secret key для серверной проверки Turnstile, его нужно взять из Cloudflare или запросить отдельно.
- Публичный sitekey можно хранить во frontend env.
- Secret key нельзя отдавать во frontend.

---

## 9. SMTP / Email verification

SMTP-сервер:

```text
clear-vpn.org
```

Email:

```text
code@clear-vpn.org
```

Логин:

```text
code@clear-vpn.org
```

Пароль:

```text
***TestAdmin123*
```

Порт:

```text
587
```

Ожидаемый режим:

```text
STARTTLS / TLS on port 587
```

Пример env-переменных:

```env
SMTP_HOST=clear-vpn.org
SMTP_PORT=587
SMTP_USER=code@clear-vpn.org
SMTP_PASSWORD=***TestAdmin123*
SMTP_FROM=code@clear-vpn.org
SMTP_SECURE=false
SMTP_STARTTLS=true
```

Названия переменных нужно адаптировать под фактический `.env.example` проекта Clean Pay.

---

## 10. Telegram OIDC для бота

Бот:

```text
https://t.me/finland3panel_bot
```

Client ID:

```text
8141013529
```

Secret Key:

```text
DG0O2hFSNdwZVFJanDAK6HFAHw_Wzs95317hitwFy7VYVcsBBH9vYw
```

Назначение:

- использовать Telegram OIDC для авторизации / подтверждения пользователя;
- связать пользователя сайта с Telegram-ботом, если это предусмотрено логикой Clean Pay;
- проверить callback URL для домена `oplata.clear-vpn.org`.

Ожидаемый callback URL зависит от реализации проекта. Возможные варианты:

```text
https://oplata.clear-vpn.org/auth/callback/telegram
https://oplata.clear-vpn.org/api/auth/callback/telegram
https://oplata.clear-vpn.org/oauth/telegram/callback
```

Нужно посмотреть фактический routing проекта Clean Pay.

---

## 11. Где брать настройки работающего бота

На стенде проверить файлы:

```text
/opt/remnashop/.env
/opt/remnawave/.env
```

Цель:

- найти токены;
- найти API URL;
- найти внутренние порты;
- найти публичные URL;
- найти переменные Telegram-бота;
- найти данные для интеграции с Remnashop / Remnawave.

Команды:

```bash
cat /opt/remnashop/.env
cat /opt/remnawave/.env
```

При передаче логов и результатов наружу секреты нужно маскировать.

---

## 12. Что нужно проверить на стенде перед деплоем Clean Pay

```bash
docker ps -a
ss -lntup
curl -I http://127.0.0.1:5000 || true
curl -I http://127.0.0.1:3000 || true
curl -I http://127.0.0.1:3001 || true
```

Проверить Caddy:

```bash
ps aux | grep caddy
systemctl status caddy --no-pager || true
docker ps -a | grep -i caddy || true
```

Проверить домен:

```bash
curl -I https://oplata.clear-vpn.org
```

Проверить DNS:

```bash
nslookup oplata.clear-vpn.org
```

---

## 13. Ожидаемый результат

После выполнения задачи должно работать:

```text
https://oplata.clear-vpn.org
```

Пользователь должен иметь возможность:

1. открыть сайт Clean Pay;
2. пройти защиту Cloudflare Turnstile;
3. подтвердить email через SMTP `code@clear-vpn.org`;
4. авторизоваться / связаться через Telegram OIDC, если это требуется сценарием;
5. получить доступ к функциям оплаты и управления подпиской;
6. взаимодействовать с Remnashop / Remnawave через API без изменения их БД.

---

## 14. Минимальный план работ

1. Перейти в локальный проект:

```powershell
cd C:\code\clean-pay
```

2. Проверить структуру проекта:

```powershell
dir
```

3. Найти env example:

```powershell
dir -Recurse -Force | findstr /i "env example"
```

4. Найти docker/devcontainer конфиги:

```powershell
dir -Recurse -Force | findstr /i "docker devcontainer compose"
```

5. Сопоставить необходимые переменные окружения с данными стенда.

6. Подключиться к стенду:

```bash
ssh root@host1.clear-vpn.org -p 6088
```

7. Проверить текущие контейнеры и порты:

```bash
docker ps -a
ss -lntup
```

8. Проверить `.env` Remnashop / Remnawave.

9. Поднять Clean Pay на свободном локальном порту.

10. Добавить reverse proxy в Caddy для `oplata.clear-vpn.org`.

11. Проверить конфиг Caddy.

12. Reload Caddy.

13. Проверить сайт снаружи.

14. Проверить сценарии авторизации, email и Turnstile.

---

## 15. Важные вопросы, которые нужно уточнить по коду Clean Pay

1. Какой backend/frontend стек используется?
2. Какие env-переменные требуются?
3. Есть ли `.env.example`?
4. Какой порт использует приложение по умолчанию?
5. Есть ли docker-compose для production/test?
6. Как реализована авторизация?
7. Как реализован Telegram OIDC?
8. Нужен ли Turnstile secret key на backend?
9. Какие API Remnashop / Remnawave уже поддерживаются?
10. Есть ли миграции БД в Clean Pay и можно ли их запускать отдельно от Remnashop / Remnawave?

---

## 16. Критерии готовности

Работу можно считать выполненной, если:

- `https://oplata.clear-vpn.org` открывается по HTTPS;
- Caddy не сломан;
- Remnawave продолжает работать;
- Remnashop продолжает работать;
- Clean Pay поднят отдельным сервисом/контейнером;
- email-отправка через `code@clear-vpn.org` работает;
- Turnstile отображается и проходит проверку;
- Telegram OIDC настроен или понятно описано, что именно блокирует настройку;
- все секреты вынесены в `.env` и не попали в репозиторий;
- есть список изменённых файлов и команд для повторения деплоя.

---

## 17. Ссылки на смежные проекты

Remnashop:

```text
https://remnashop.mintlify.app/docs/ru/overview/releases
https://github.com/snoups/remnashop
```

Remnawave:

```text
https://docs.rw
https://github.com/remnawave
```

Telegram bot:

```text
https://t.me/finland3panel_bot
```
