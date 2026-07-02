FROM node:24-bookworm-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://clean_pay:clean_pay@localhost:5432/clean_pay?schema=public
ENV APP_URL=http://localhost:4000
ENV NEXT_PUBLIC_APP_URL=http://localhost:4000
ENV REMNASHOP_API_BASE_URL=https://remnashop.example.com/api/v1/public
ENV REDIS_URL=redis://localhost:6379/0
ENV WEB_JWT_SECRET=build-time-placeholder
ENV WEB_REFRESH_SECRET=build-time-placeholder
ENV AUDIT_IP_HASH_SECRET=build-time-placeholder
ENV COOKIE_SECURE=false
ENV COOKIE_SAMESITE=lax
ENV TELEGRAM_OIDC_ISSUER=https://oauth.telegram.org
ENV TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT=https://oauth.telegram.org/auth
ENV TELEGRAM_OIDC_TOKEN_ENDPOINT=https://oauth.telegram.org/token
ENV TELEGRAM_OIDC_JWKS_URI=https://oauth.telegram.org/.well-known/jwks.json
ENV TELEGRAM_OIDC_CLIENT_ID=build-time-placeholder
ENV TELEGRAM_OIDC_CLIENT_SECRET=build-time-placeholder
ARG TURNSTILE_ENABLED=false
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG TURNSTILE_SITE_KEY=
ENV TURNSTILE_ENABLED=${TURNSTILE_ENABLED}
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY:-${TURNSTILE_SITE_KEY}}
ENV TURNSTILE_VERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify
ENV SUPPORT_ENABLED=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run prisma:generate
RUN npm run build

FROM node:24-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

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
COPY --from=builder --chown=cleanpay:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --chown=cleanpay:nodejs deploy/prod/start.sh ./deploy/prod/start.sh

RUN sed -i 's/\r$//' ./deploy/prod/start.sh \
  && chmod +x ./deploy/prod/start.sh

USER cleanpay

EXPOSE 4000

CMD ["./deploy/prod/start.sh"]
