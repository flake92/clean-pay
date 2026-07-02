# E2E Devcontainer Checklist

1. Сделать корректный `test:e2e:devcontainer` скрипт.
   Сейчас нет главной команды из задачи, которая поднимает стенд, ждет readiness, запускает Next на 4000, гоняет full-stack HTTP тесты и печатает диагностику.

2. Убрать опасное удаление volumes по умолчанию.
   Сейчас `tests/integration/setup/global-setup.ts` делает `down --volumes` без reset-флага. Это самый неприятный риск для данных dev-стенда.

3. Привязать e2e к devcontainer stack, а не к отдельному integration compose.
   Сейчас тесты проверяют похожий, но отдельный стенд на 4100/8125/8190, а задача просит проверять devcontainer как основной локальный стенд.

4. Убрать hardcoded `/Users/alex/...` и `chmod 666 /var/run/docker.sock`.
   Это бьет по воспроизводимости и безопасности devcontainer.

5. Добавить команды `test:e2e` и `test:e2e:devcontainer` в `package.json`.
   Небольшой пункт, но он нужен для стандартного входа в e2e.

6. Расширить readiness.
   Сейчас проверяются PostgreSQL, Redis, Remnashop. Нужно добавить Mailpit, Telegram OIDC mock, Remnawave mock по env/config.

7. Оформить endpoint matrix.
   Сейчас матрица фактически живет в тестовых массивах, но не оформлена как явный артефакт с требованиями по сессии, verified email, upstream и 5xx.

8. Решить судьбу `/api/health/liveness`.
   Либо добавить endpoint, либо явно зафиксировать, что его нет и тесты проверяют фактический список.

9. Улучшить e2e диагностику.
   Часть уже есть в Vitest, но будущий shell-скрипт тоже должен печатать шаг, URL, status/body и логи сервисов.
