FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
ARG NEXT_PUBLIC_APP_URL=https://oplata.clear-vpn.org
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ARG NEXT_PUBLIC_TURNSTILE_ENABLED=false
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres?schema=public
ENV APP_URL=https://oplata.clear-vpn.org
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
ENV REMNASHOP_API_BASE_URL=https://example.com/api/v1/public
ENV WEB_JWT_SECRET=build-time-secret
ENV WEB_REFRESH_SECRET=build-time-secret
ENV AUDIT_IP_HASH_SECRET=build-time-secret
ENV TELEGRAM_OIDC_ISSUER=https://oauth.telegram.org
ENV TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT=https://oauth.telegram.org/auth
ENV TELEGRAM_OIDC_TOKEN_ENDPOINT=https://oauth.telegram.org/token
ENV TELEGRAM_OIDC_JWKS_URI=https://oauth.telegram.org/.well-known/jwks.json
ENV TELEGRAM_OIDC_CLIENT_ID=build-client-id
ENV TELEGRAM_OIDC_CLIENT_SECRET=build-time-secret
ENV TURNSTILE_ENABLED=false
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_ENABLED=$NEXT_PUBLIC_TURNSTILE_ENABLED
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build


FROM deps AS migrate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres?schema=public
ENV HOME=/tmp
ENV npm_config_cache=/tmp/.npm
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
CMD ["npx", "prisma", "migrate", "deploy"]
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
