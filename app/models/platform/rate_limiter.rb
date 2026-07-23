module Platform
  class RateLimiter
    class ExceededError < StandardError
      attr_reader :retry_after

      def initialize(retry_after)
        @retry_after = retry_after
        super("rate limited")
      end
    end

    def initialize(redis: Integrations::RedisStore.new)
      @redis = redis
    end

    def check!(action:, identity:, limit:, window:, evidence: true,
      fail_open: false)
      digest = OpenSSL::HMAC.hexdigest(
        "SHA256",
        secret,
        identity.to_s
      )
      key = "clean-pay:rate:#{action}:#{digest}"
      count = redis.increment(key:, window:)
      record_evidence(action:, digest:) if evidence
      raise ExceededError.new(
        redis.ttl(key:, fallback: window)
      ) if count > limit

      count
    rescue Redis::BaseError, ConnectionPool::Error
      raise unless fail_open

      record_evidence(action:, digest:, degraded: true) if evidence
      0
    end

    private

    attr_reader :redis

    def secret
      Rails.application.config.x.clean_pay.security
        .rate_limit_identity_secret&.value ||
        Rails.application.key_generator.generate_key("rate-limit", 32)
    end

    def record_evidence(action:, digest:, degraded: false)
      RateLimitEvent.create!(
        action:,
        key: digest,
        occurred_at: Time.current,
        metadata: { "degraded" => degraded }
      )
    end
  end
end
