FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS dependencies

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Runtime packages receive security fixes from the digest-pinned Debian base and
# are covered by the image vulnerability gate; exact apt versions would prevent
# those fixes from being selected on a rebuild.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM dependencies AS builder

ARG CLEAN_PAY_REVISION=local
ARG NEXT_PUBLIC_APP_URL
ARG TURNSTILE_ENABLED=true
ARG TURNSTILE_WIDGET_ID=build-time-placeholder-site-key
ARG NEXT_PUBLIC_BRAND_NAME="Clean Pay"
ARG NEXT_PUBLIC_BRAND_LOGO_URL=/clean-pay-logo.png

COPY next.config.ts prisma.config.ts tsconfig.json ./
COPY scripts/next-command.mjs scripts/prisma-generate.mjs ./scripts/
COPY runtime/database-pool.mjs runtime/production-env-rules.mjs ./runtime/
COPY prisma ./prisma
COPY public ./public
COPY src ./src
RUN NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL}" \
    CLEAN_PAY_BUILD_ID="${CLEAN_PAY_REVISION}" \
    NEXT_PUBLIC_BRAND_NAME="${NEXT_PUBLIC_BRAND_NAME}" \
    NEXT_PUBLIC_BRAND_LOGO_URL="${NEXT_PUBLIC_BRAND_LOGO_URL}" \
    TURNSTILE_ENABLED="${TURNSTILE_ENABLED}" \
    TURNSTILE_SITE_KEY="${TURNSTILE_WIDGET_ID}" \
    npm run build

FROM node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS runtime-base

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Runtime packages receive security fixes from the digest-pinned Debian base and
# are covered by the image vulnerability gate; exact apt versions would prevent
# those fixes from being selected on a rebuild.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs cleanpay \
    && rm -rf /usr/local/lib/node_modules/npm \
        /usr/local/lib/node_modules/corepack \
        /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx \
        /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

FROM runtime-base AS migration

ARG CLEAN_PAY_RELEASE=local
ARG CLEAN_PAY_REVISION=local
ARG CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION=local
ARG CLEAN_PAY_PUBLIC_BUILD_CONTRACT_SHA256=local

LABEL org.opencontainers.image.revision="${CLEAN_PAY_REVISION}" \
      org.opencontainers.image.version="${CLEAN_PAY_RELEASE}" \
      io.clean-pay.release="${CLEAN_PAY_RELEASE}" \
      io.clean-pay.role="migration" \
      io.clean-pay.public-build-contract-version="${CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION}" \
      io.clean-pay.public-build-contract-sha256="${CLEAN_PAY_PUBLIC_BUILD_CONTRACT_SHA256}"

COPY --from=dependencies --chown=cleanpay:nodejs /app/package.json /app/package-lock.json ./
COPY --from=dependencies --chown=cleanpay:nodejs /app/node_modules ./node_modules
COPY --chown=cleanpay:nodejs prisma ./prisma
COPY --chown=cleanpay:nodejs prisma.config.ts ./prisma.config.ts
COPY --chown=cleanpay:nodejs runtime/database-pool.mjs ./runtime/database-pool.mjs
COPY --chown=cleanpay:nodejs runtime/production-env-rules.mjs ./runtime/production-env-rules.mjs
COPY --chown=cleanpay:nodejs deploy/prod/deploy-log.mjs ./deploy/prod/deploy-log.mjs
COPY --chown=cleanpay:nodejs deploy/prod/database-pool.mjs ./deploy/prod/database-pool.mjs
COPY --chown=cleanpay:nodejs deploy/prod/credential-file-guard.mjs ./deploy/prod/credential-file-guard.mjs
COPY --chown=cleanpay:nodejs deploy/prod/validate-env.mjs ./deploy/prod/validate-env.mjs
COPY --chown=cleanpay:nodejs deploy/prod/production-env-rules.mjs ./deploy/prod/production-env-rules.mjs
COPY --chown=cleanpay:nodejs deploy/prod/migration-rollback-verifier.mjs ./deploy/prod/migration-rollback-verifier.mjs
COPY --chown=cleanpay:nodejs deploy/prod/database-privilege-manifest.mjs ./deploy/prod/database-privilege-manifest.mjs
COPY --chown=cleanpay:nodejs deploy/prod/database-role-provision.mjs ./deploy/prod/database-role-provision.mjs

# Exercise the migration CLI and its platform engine while the image is still
# being built. A syntactically valid placeholder URL is sufficient for schema
# validation and cannot open a database connection.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    node node_modules/prisma/build/index.js validate

USER cleanpay

CMD ["sh", "-c", "node deploy/prod/validate-env.mjs && node node_modules/prisma/build/index.js migrate deploy"]

FROM runtime-base AS runner

ARG CLEAN_PAY_RELEASE=local
ARG CLEAN_PAY_REVISION=local
ARG CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION=local
ARG CLEAN_PAY_PUBLIC_BUILD_CONTRACT_SHA256=local
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_BRAND_NAME="Clean Pay"
ARG NEXT_PUBLIC_BRAND_LOGO_URL=/clean-pay-logo.png
ARG TURNSTILE_WIDGET_ID

LABEL org.opencontainers.image.revision="${CLEAN_PAY_REVISION}" \
      org.opencontainers.image.version="${CLEAN_PAY_RELEASE}" \
      io.clean-pay.release="${CLEAN_PAY_RELEASE}" \
      io.clean-pay.role="app" \
      io.clean-pay.public-build-contract-version="${CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION}" \
      io.clean-pay.public-build-contract-sha256="${CLEAN_PAY_PUBLIC_BUILD_CONTRACT_SHA256}" \
      io.clean-pay.baked-public-app-url="${NEXT_PUBLIC_APP_URL}" \
      io.clean-pay.baked-brand-name="${NEXT_PUBLIC_BRAND_NAME}" \
      io.clean-pay.baked-brand-logo-url="${NEXT_PUBLIC_BRAND_LOGO_URL}" \
      io.clean-pay.baked-turnstile-site-key="${TURNSTILE_WIDGET_ID}"

ENV CLEAN_PAY_BAKED_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV CLEAN_PAY_BAKED_BRAND_NAME=${NEXT_PUBLIC_BRAND_NAME}
ENV CLEAN_PAY_BAKED_BRAND_LOGO_URL=${NEXT_PUBLIC_BRAND_LOGO_URL}
ENV CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID=${TURNSTILE_WIDGET_ID}
ENV HOSTNAME=0.0.0.0
ENV PORT=4000

COPY --from=builder --chown=cleanpay:nodejs /app/.next/standalone ./
COPY --from=builder --chown=cleanpay:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=cleanpay:nodejs /app/public ./public
# The standalone server bundles this adapter, while the retention worker imports
# it directly. Copy only its runtime package pair; Prisma CLI remains migration-only.
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/@prisma/adapter-pg ./node_modules/@prisma/adapter-pg
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/@prisma/driver-adapter-utils ./node_modules/@prisma/driver-adapter-utils
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/@prisma/debug ./node_modules/@prisma/debug
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/pg ./node_modules/pg
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/pg-cloudflare ./node_modules/pg-cloudflare
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/pg-connection-string ./node_modules/pg-connection-string
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/pg-int8 ./node_modules/pg-int8
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/pg-pool ./node_modules/pg-pool
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/pg-protocol ./node_modules/pg-protocol
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/pg-types ./node_modules/pg-types
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/pgpass ./node_modules/pgpass
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/postgres-bytea ./node_modules/postgres-bytea
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/postgres-date ./node_modules/postgres-date
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/postgres-interval ./node_modules/postgres-interval
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/split2 ./node_modules/split2
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/xtend ./node_modules/xtend
COPY --chown=cleanpay:nodejs runtime/database-pool.mjs ./runtime/database-pool.mjs
COPY --chown=cleanpay:nodejs runtime/production-env-rules.mjs ./runtime/production-env-rules.mjs
COPY --chown=cleanpay:nodejs deploy/prod/start.sh ./deploy/prod/start.sh
COPY --chown=cleanpay:nodejs deploy/prod/deploy-log.mjs ./deploy/prod/deploy-log.mjs
COPY --chown=cleanpay:nodejs deploy/prod/database-pool.mjs ./deploy/prod/database-pool.mjs
COPY --chown=cleanpay:nodejs deploy/prod/credential-file-guard.mjs ./deploy/prod/credential-file-guard.mjs
COPY --chown=cleanpay:nodejs deploy/prod/worker-shutdown.mjs ./deploy/prod/worker-shutdown.mjs
COPY --chown=cleanpay:nodejs deploy/prod/validate-env.mjs ./deploy/prod/validate-env.mjs
COPY --chown=cleanpay:nodejs deploy/prod/production-env-rules.mjs ./deploy/prod/production-env-rules.mjs
COPY --chown=cleanpay:nodejs deploy/prod/reconcile-loop.mjs ./deploy/prod/reconcile-loop.mjs
COPY --chown=cleanpay:nodejs deploy/prod/reconciliation-batch.mjs ./deploy/prod/reconciliation-batch.mjs
COPY --chown=cleanpay:nodejs deploy/prod/reconciliation-support-handle.mjs ./deploy/prod/reconciliation-support-handle.mjs
COPY --chown=cleanpay:nodejs deploy/prod/retention-cleanup.mjs ./deploy/prod/retention-cleanup.mjs
COPY --chown=cleanpay:nodejs deploy/prod/retention-heartbeat.mjs ./deploy/prod/retention-heartbeat.mjs
COPY --chown=cleanpay:nodejs deploy/prod/retention-loop.mjs ./deploy/prod/retention-loop.mjs
COPY --chown=cleanpay:nodejs deploy/prod/payment-retention-hold.mjs ./deploy/prod/payment-retention-hold.mjs
COPY --chown=cleanpay:nodejs deploy/prod/payment-retention-hold-command.mjs ./deploy/prod/payment-retention-hold-command.mjs
COPY --chown=cleanpay:nodejs deploy/prod/encryption-rewrap.mjs ./deploy/prod/encryption-rewrap.mjs
COPY --chown=cleanpay:nodejs deploy/prod/encryption-rewrap-command.mjs ./deploy/prod/encryption-rewrap-command.mjs

RUN sed -i 's/\r$//' ./deploy/prod/start.sh \
    && chmod +x ./deploy/prod/start.sh

USER cleanpay

EXPOSE 4000

CMD ["./deploy/prod/start.sh"]
