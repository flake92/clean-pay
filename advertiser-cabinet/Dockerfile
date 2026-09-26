FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4100

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs advertiser

COPY --from=dependencies --chown=advertiser:nodejs /app/node_modules ./node_modules
COPY --chown=advertiser:nodejs package.json ./package.json
COPY --chown=advertiser:nodejs src ./src

USER advertiser
EXPOSE 4100

CMD ["node", "src/server.mjs"]
