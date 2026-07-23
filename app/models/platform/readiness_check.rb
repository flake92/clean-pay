module Platform
  class ReadinessCheck
    Check = Data.define(:status, :latency_ms, :message)
    Result = Data.define(:status, :checked_at, :checks)

    class << self
      attr_accessor :memory_snapshot
    end

    def initialize(redis: Integrations::RedisStore.new, probes: nil)
      @redis = redis
      @probes = probes || default_probes
    end

    def call
      futures = probes.transform_values do |probe|
        Concurrent::Promises.future { measure(&probe) }
      end
      checks = futures.transform_values do |future|
        future.value!(8)
      rescue Concurrent::TimeoutError, StandardError => error
        Check.new(
          status: "down",
          latency_ms: 8_000,
          message: error.class.name
        )
      end
      result = Result.new(
        status: checks.values.all? { _1.status == "ok" } ? "ok" : "degraded",
        checked_at: Time.current,
        checks:
      )
      publish(result)
    end

    def self.public_snapshot(redis: Integrations::RedisStore.new,
      at: Time.current)
      value = redis.read_readiness || memory_snapshot
      checked_at = Time.iso8601(value.fetch("checked_at")) if value
      fresh = checked_at && checked_at >= 90.seconds.ago(at)
      {
        "status" => fresh && value["status"] == "ok" ? "ok" : "degraded",
        "checked_at" => fresh ? checked_at.iso8601 : nil,
        "stale" => !fresh
      }
    rescue Redis::BaseError, ConnectionPool::Error, KeyError, ArgumentError
      {
        "status" => "degraded",
        "checked_at" => nil,
        "stale" => true
      }
    end

    private

    attr_reader :redis, :probes

    def default_probes
      values = {
        "postgresql" => -> { ActiveRecord::Base.connection.select_value("SELECT 1") },
        "redis" => -> { redis.ping },
        "remnashop" => -> { Integrations::RemnashopClient.new.public_plans },
        "telegram" => -> { Integrations::TelegramOidcClient.new.jwks }
      }
      config = Rails.application.config.x.clean_pay
      values["remnawave"] = -> {
        raise "unavailable" unless Integrations::RemnawaveClient.new.ready?
      } if config.readiness.remnawave_url
      values["mailpit"] = -> {
        raise "unavailable" unless Integrations::MailpitClient.new.ready?
      } if config.readiness.mailpit_url
      values
    end

    def measure
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      yield
      Check.new(
        status: "ok",
        latency_ms: elapsed_ms(started),
        message: nil
      )
    rescue StandardError => error
      Check.new(
        status: "down",
        latency_ms: elapsed_ms(started),
        message: error.class.name
      )
    end

    def elapsed_ms(started)
      ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1_000).round
    end

    def publish(result)
      snapshot = {
        "status" => result.status,
        "checked_at" => result.checked_at.iso8601
      }
      self.class.memory_snapshot = snapshot
      redis.write_readiness(snapshot)
      result
    rescue Redis::BaseError, ConnectionPool::Error
      checks = result.checks.merge(
        "redis_snapshot" => Check.new(
          status: "down",
          latency_ms: 0,
          message: "snapshot unavailable"
        )
      )
      Result.new(status: "degraded", checked_at: result.checked_at, checks:)
    end
  end
end
