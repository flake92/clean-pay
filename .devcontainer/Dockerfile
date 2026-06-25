FROM mcr.microsoft.com/devcontainers/javascript-node:4-24-bookworm

RUN apt-get update \
  && export DEBIAN_FRONTEND=noninteractive \
  && apt-get install -y --no-install-recommends \
    curl \
    postgresql-client \
    redis-tools \
  && rm -rf /var/lib/apt/lists/*
