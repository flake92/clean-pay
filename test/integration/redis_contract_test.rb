require "test_helper"

class RedisContractTest < ActiveSupport::TestCase
  setup do
    @store = Integrations::RedisStore.new
    @key = "clean-pay:test:#{SecureRandom.hex(12)}"
  end

  teardown do
    Rails.application.config.x.redis_pool.with do |redis|
      redis.del(@key)
      redis.del(Integrations::RedisStore::READINESS_KEY)
    end
  end

  test "REDIS-001 returns exact PONG" do
    assert_equal "PONG", @store.ping
  end

  test "REDIS-002 and REDIS-003 increment atomically with a TTL" do
    assert_equal 1, @store.increment(key: @key, window: 60)
    assert_equal 2, @store.increment(key: @key, window: 60)
    assert @store.ttl(key: @key, fallback: 60).between?(1, 60)
  end

  test "REDIS-004 and REDIS-005 round-trip a bounded readiness snapshot" do
    snapshot = {
      "status" => "ok",
      "checked_at" => Time.current.iso8601
    }

    assert @store.write_readiness(snapshot)
    assert_equal snapshot, @store.read_readiness
  end
end
