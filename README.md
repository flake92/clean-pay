# Clean Pay

Web-кабинет CleanVPN для оплаты и управления подпиской без Telegram.

## Stack

- Next.js App Router
- TypeScript
- npm
- Prisma ORM
- PostgreSQL in devcontainer

## Local Development

Все команды приложения выполняются внутри devcontainer `app`.

```bash
cd /workspaces/clean-pay
npm install
npm run dev
```

PostgreSQL доступен внутри Docker-сети по адресу `db:5432`.
В devcontainer `DATABASE_URL` передаётся через `.devcontainer/docker-compose.yml`;
локальный `.env` для разработки не нужен.

```bash
DATABASE_URL="postgresql://postgres:postgres@db:5432/postgres?schema=public"
```

## Database

```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

`node_modules` хранится в Docker volume, а не в Windows bind mount.

## Docs

- Project architecture: `docs/architecture.md`
- Source plan: `clean-pay-plan.md`
