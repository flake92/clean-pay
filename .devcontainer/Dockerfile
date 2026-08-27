FROM mcr.microsoft.com/devcontainers/javascript-node:4-24-bookworm@sha256:df5c21fdbb9cfa3ee2aae7f05499af7acf073597d250d07476df2d8515c4b853

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Development tooling receives security fixes from the digest-pinned base and
# is never copied into production images. Exact apt versions would prevent those
# fixes from being selected on a rebuild.
# hadolint ignore=DL3008
RUN apt-get update \
  && export DEBIAN_FRONTEND=noninteractive \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    postgresql-client \
    redis-tools \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && . /etc/os-release \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    docker-buildx-plugin \
    docker-ce-cli \
    docker-compose-plugin \
  && rm -rf /var/lib/apt/lists/*
