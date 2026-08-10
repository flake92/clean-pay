FROM node:24.18.0-bookworm-slim AS dependencies

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM dependencies AS builder

ARG NEXT_PUBLIC_APP_URL
ARG TURNSTILE_ENABLED=true
ARG TURNSTILE_WIDGET_ID=build-time-placeholder-site-key
ARG NEXT_PUBLIC_BRAND_NAME="Clean Pay"
ARG NEXT_PUBLIC_BRAND_LOGO_URL=/clean-pay-logo.png

COPY . .
RUN DATABASE_URL="postgresql://clean_pay:clean_pay@localhost:5432/clean_pay?schema=public" \
    npm run prisma:generate
RUN NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL}" \
    NEXT_PUBLIC_BRAND_NAME="${NEXT_PUBLIC_BRAND_NAME}" \
    NEXT_PUBLIC_BRAND_LOGO_URL="${NEXT_PUBLIC_BRAND_LOGO_URL}" \
    TURNSTILE_ENABLED="${TURNSTILE_ENABLED}" \
    TURNSTILE_SITE_KEY="${TURNSTILE_WIDGET_ID}" \
    npm run build

FROM node:24.18.0-bookworm-slim AS runtime-base

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

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

COPY --from=dependencies --chown=cleanpay:nodejs /app/package.json /app/package-lock.json ./
COPY --from=dependencies --chown=cleanpay:nodejs /app/node_modules ./node_modules
COPY --chown=cleanpay:nodejs prisma ./prisma
COPY --chown=cleanpay:nodejs prisma.config.ts ./prisma.config.ts
COPY --chown=cleanpay:nodejs deploy/prod/deploy-log.mjs ./deploy/prod/deploy-log.mjs
COPY --chown=cleanpay:nodejs deploy/prod/validate-env.mjs ./deploy/prod/validate-env.mjs
COPY --chown=cleanpay:nodejs deploy/prod/production-env-rules.mjs ./deploy/prod/production-env-rules.mjs

USER cleanpay

CMD ["sh", "-c", "node deploy/prod/validate-env.mjs && node node_modules/prisma/build/index.js migrate deploy"]

FROM runtime-base AS runner

ARG NEXT_PUBLIC_APP_URL
ENV CLEAN_PAY_BAKED_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
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
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules/postgres-array ./node_modules/postgres-array
COPY --chown=cleanpay:nodejs deploy/prod/start.sh ./deploy/prod/start.sh
COPY --chown=cleanpay:nodejs deploy/prod/deploy-log.mjs ./deploy/prod/deploy-log.mjs
COPY --chown=cleanpay:nodejs deploy/prod/validate-env.mjs ./deploy/prod/validate-env.mjs
COPY --chown=cleanpay:nodejs deploy/prod/production-env-rules.mjs ./deploy/prod/production-env-rules.mjs
COPY --chown=cleanpay:nodejs deploy/prod/reconcile-loop.mjs ./deploy/prod/reconcile-loop.mjs
COPY --chown=cleanpay:nodejs deploy/prod/reconciliation-batch.mjs ./deploy/prod/reconciliation-batch.mjs
COPY --chown=cleanpay:nodejs deploy/prod/retention-cleanup.mjs ./deploy/prod/retention-cleanup.mjs
COPY --chown=cleanpay:nodejs deploy/prod/retention-loop.mjs ./deploy/prod/retention-loop.mjs

RUN sed -i 's/\r$//' ./deploy/prod/start.sh \
    && chmod +x ./deploy/prod/start.sh

USER cleanpay

EXPOSE 4000

CMD ["./deploy/prod/start.sh"]
