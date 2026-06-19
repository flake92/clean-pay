# Clean Pay documentation

## Назначение

Clean Pay - отдельный web-кабинет CleanVPN для пользователей без Telegram.

## Текущие решения

- Frontend/BFF: Next.js App Router.
- Язык: TypeScript.
- Package manager: npm.
- ORM: Prisma.
- Собственная БД: PostgreSQL из devcontainer.
- БД Remnashop: прямого подключения нет.
- Remnashop используется только через API.
- E-mail-коды отправляет web-кабинет.
- Return URLs после оплаты обрабатывает web-кабинет.

## Источники

- Remnashop repository: https://github.com/snoups/remnashop
- Remnashop public docs: https://remnashop.mintlify.app
- Environment documentation: `docs/environment.md`

## Локальная среда

- Devcontainer service: `app`.
- PostgreSQL service: `db`.
- Workspace in container: `/workspaces/clean-pay`.
- Local database URL: `postgresql://postgres:postgres@db:5432/postgres?schema=public`.
- Node dependencies live in Docker volume `clean-pay_devcontainer_node-modules`.
- Dev env values are provided by `.devcontainer/docker-compose.yml`; local `.env` is not required.

## Границы интеграции

- Web-кабинет хранит только свои служебные данные.
- Источник истины по тарифам, подпискам, оплатам и VPN-доступам - Remnashop.
- Секреты хранятся только в env и не попадают в frontend.

## Prisma

- Version: Prisma 7.
- Config file: `prisma.config.ts`.
- Runtime adapter: `@prisma/adapter-pg`.
- Schema file: `prisma/schema.prisma`.
- Initial migration: `prisma/migrations/*_init`.
