FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 DATABASE_URL=postgresql://a:a@localhost:5432/a APP_URL=http://localhost:4000 REMNASHOP_API_BASE_URL=http://remnashop:5000/api/v1/public REMNASHOP_ADMIN_API_BASE_URL=http://remnashop:5000/api/v1/admin REMNAWAVE_API_BASE_URL=http://remnawave:3000 REMNAWAVE_TOKEN=build-placeholder REDIS_URL=redis://localhost:6379 WEB_JWT_SECRET=build-placeholder WEB_REFRESH_SECRET=build-placeholder AUDIT_IP_HASH_SECRET=build-placeholder RATE_LIMIT_IDENTITY_SECRET=build-placeholder READINESS_INTERNAL_SECRET=build-placeholder COOKIE_SECURE=false COOKIE_SAMESITE=lax TELEGRAM_OIDC_CLIENT_ID=1 TELEGRAM_OIDC_CLIENT_SECRET=build-placeholder TURNSTILE_SECRET_KEY=build-placeholder SUPPORT_ENABLED=false
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ARG TURNSTILE_ENABLED=false
ARG TURNSTILE_SITE_KEY=
ARG NEXT_PUBLIC_BRAND_NAME="Clean Pay"
ARG NEXT_PUBLIC_BRAND_LOGO_URL=/clean-pay-logo.png
ENV TURNSTILE_ENABLED=${TURNSTILE_ENABLED} TURNSTILE_SITE_KEY=${TURNSTILE_SITE_KEY} NEXT_PUBLIC_BRAND_NAME=${NEXT_PUBLIC_BRAND_NAME} NEXT_PUBLIC_BRAND_LOGO_URL=${NEXT_PUBLIC_BRAND_LOGO_URL} TURNSTILE_VERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run prisma:generate && npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ARG NEXT_PUBLIC_APP_URL
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
ENV CLEAN_PAY_BAKED_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs cleanpay
COPY --from=builder --chown=cleanpay:nodejs /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=cleanpay:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=cleanpay:nodejs /app/.next ./.next
COPY --from=builder --chown=cleanpay:nodejs /app/public ./public
COPY --from=builder --chown=cleanpay:nodejs /app/prisma ./prisma
COPY --from=builder --chown=cleanpay:nodejs /app/prisma.config.ts ./
COPY --from=builder --chown=cleanpay:nodejs /app/deploy/prod/start.sh /app/deploy/prod/validate-env.mjs /app/deploy/prod/production-env-rules.mjs /app/deploy/prod/reconcile-loop.mjs /app/deploy/prod/reconciliation-batch.mjs /app/deploy/prod/retention-cleanup.mjs /app/deploy/prod/retention-loop.mjs ./deploy/prod/
RUN chmod +x ./deploy/prod/start.sh
USER cleanpay
EXPOSE 4000
CMD ["./deploy/prod/start.sh"]
