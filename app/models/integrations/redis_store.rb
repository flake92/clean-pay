module Integrations
  class RedisStore
    READINESS_KEY = "clean-pay:health:readiness:v1"

    def initialize(pool: Rails.application.config.x.redis_pool)
      @pool = pool
    end

    def ping
      with { _1.ping }
    end

    def increment(key:, window:)
      script = <<~LUA
        local count = redis.call("INCR", KEYS[1])
        if count == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
        return count
      LUA
      with { _1.eval(script, keys: [ key ], argv: [ Integer(window) ]) }
    end

    def ttl(key:, fallback:)
      value = with { _1.ttl(key) }
      value.positive? ? value : Integer(fallback)
    end

    def write_readiness(snapshot)
      with {
        _1.set(
          READINESS_KEY,
          JSON.generate(snapshot),
          ex: 120
        )
      }
      true
    end

    def read_readiness
      value = with { _1.get(READINESS_KEY) }
      return unless value
      raise JSON::ParserError if value.bytesize > 65_536

      JSON.parse(value)
    rescue JSON::ParserError
      nil
    end

    private

    attr_reader :pool

    def with(&) = pool.with(&)
  end
end
