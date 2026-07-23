# syntax=docker/dockerfile:1

ARG RUBY_VERSION=4.0.6
FROM ruby:${RUBY_VERSION}-slim AS build

WORKDIR /rails

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential git libpq-dev && \
    rm -rf /var/lib/apt/lists/*

COPY Gemfile Gemfile.lock ./
RUN bundle config set deployment true && \
    bundle install && \
    rm -rf /root/.bundle "${BUNDLE_PATH:-/usr/local/bundle}"/ruby/*/cache

COPY . .
RUN bundle exec bootsnap precompile --gemfile app/ lib/
RUN SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=development bin/rails assets:precompile

FROM ruby:${RUBY_VERSION}-slim

ENV LANG=C.UTF-8 \
    RAILS_ENV=production \
    RAILS_LOG_TO_STDOUT=true \
    BUNDLE_DEPLOYMENT=true

RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y curl libpq5 postgresql-client && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd --system --gid 1000 rails && \
    useradd rails --uid 1000 --gid 1000 --create-home --shell /bin/bash

WORKDIR /rails
COPY --from=build /usr/local/bundle /usr/local/bundle
COPY --from=build --chown=rails:rails /rails /rails

RUN mkdir -p tmp/pids tmp/cache log storage && chown -R rails:rails tmp log storage

USER rails:rails
EXPOSE 4000
STOPSIGNAL SIGINT

ENTRYPOINT ["/rails/bin/docker-entrypoint"]
CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "4000"]
