require "test_helper"
require "tmpdir"

class Platform::PlatformOperationsTest < ActiveSupport::TestCase
  class MemoryRedis
    attr_reader :snapshot, :counts

    def initialize
      @counts = Hash.new(0)
    end

    def ping = "PONG"

    def write_readiness(value)
      @snapshot = value
      true
    end

    def read_readiness = snapshot

    def increment(key:, window:)
      raise "missing window" unless window.positive?

      counts[key] += 1
    end

    def ttl(key:, fallback:)
      counts.key?(key) ? fallback - 1 : fallback
    end
  end

  test "publishes a sanitized aggregate from concurrent probes" do
    redis = MemoryRedis.new
    result = Platform::ReadinessCheck.new(
      redis:,
      probes: {
        "postgresql" => -> { 1 },
        "redis" => -> { "PONG" }
      }
    ).call

    assert_equal "ok", result.status
    assert_equal %w[postgresql redis], result.checks.keys
    assert_equal "ok", redis.snapshot.fetch("status")
    assert_not redis.snapshot.key?("checks")
  end

  test "rate limiter stores only a digest and exposes retry after" do
    redis = MemoryRedis.new
    limiter = Platform::RateLimiter.new(redis:)

    limiter.check!(
      action: "login",
      identity: "personal@example.test",
      limit: 1,
      window: 60
    )
    error = assert_raises(Platform::RateLimiter::ExceededError) do
      limiter.check!(
        action: "login",
        identity: "personal@example.test",
        limit: 1,
        window: 60
      )
    end

    assert_equal 59, error.retry_after
    assert_equal 2, RateLimitEvent.where(action: "login").count
    assert RateLimitEvent.where(action: "login").none? {
      _1.key.include?("@")
    }
  end

  test "retention never deletes users or payment data" do
    user = create_web_user
    operation = user.payment_operations.create!(
      kind: :purchase,
      idempotency_key_hash: SecureRandom.hex(32),
      request_fingerprint: SecureRandom.hex(32),
      request_payload: { "plan_code" => "basic" },
      upstream_key: SecureRandom.uuid
    )
    user.payment_records.create!(
      payment_operation: operation,
      payment_id: SecureRandom.uuid,
      purchase_type: :new_purchase,
      status: :completed,
      final_amount: "0.00",
      currency: "RUB",
      gateway_type: "CARD"
    )
    old = RateLimitEvent.create!(
      action: "old",
      key: SecureRandom.hex(32),
      occurred_at: 31.days.ago
    )

    result = Platform::RetentionBatch.new.call

    assert_equal 1, result.rate_limits
    assert_not RateLimitEvent.exists?(old.id)
    assert WebUser.exists?(user.id)
    assert PaymentOperation.exists?(operation.id)
    assert_equal 1, user.payment_records.count
  end

  test "heartbeat replacement is parseable and has bounded freshness" do
    Dir.mktmpdir do |directory|
      heartbeat = Platform::Heartbeat.new(
        File.join(directory, "heartbeat")
      )
      heartbeat.write(at: Time.at(100))

      assert heartbeat.fresh?(within: 2.seconds, at: Time.at(101))
      assert_not heartbeat.fresh?(within: 2.seconds, at: Time.at(103))
    end
  end

  test "interval runner executes immediately and stops without another tick" do
    calls = 0
    heartbeat = Minitest::Mock.new
    heartbeat.expect(:write, true)
    runner = nil
    runner = Platform::IntervalRunner.new(
      interval: 60,
      task: -> {
        calls += 1
        runner.stop
      },
      heartbeat:,
      sleeper: ->(_) { flunk "must not sleep after stop" }
    )

    runner.run

    assert_equal 1, calls
    heartbeat.verify
  end

  test "reconciliation runner validates machine counters" do
    response = Integrations::HttpClient::Response.new(
      status: 200,
      headers: {},
      body: {
        "claimed" => 1,
        "succeeded" => 1,
        "deferred" => 0,
        "manual_required" => 0,
        "failed" => 0,
        "history" => {
          "claimed" => 0,
          "succeeded" => 0,
          "deferred" => 0,
          "failed" => 0
        }
      }
    )
    http = Minitest::Mock.new
    http.expect(:request, response) do |method, path, headers:|
      method == :post && path == "" &&
        headers["X-Clean-Pay-Reconciliation-Secret"].present?
    end
    config = reconciliation_config

    Rails.application.config.x.stub(:clean_pay, config) do
      assert_equal response.body,
        Platform::ReconciliationRunner.new(http:).tick
    end
    http.verify
  end

  private

  def reconciliation_config
    original = Rails.application.config.x.clean_pay
    reconciliation = original.reconciliation.with(
      enabled: true,
      secret: CleanPay::AppConfig::Secret.new("r" * 32),
      internal_url: URI("http://app:4000/internal/payment_reconciliations")
    )
    Object.new.tap do |wrapper|
      wrapper.define_singleton_method(:reconciliation) { reconciliation }
      wrapper.define_singleton_method(:method_missing) do |name, *args, **kwargs,
        &block|
        original.public_send(name, *args, **kwargs, &block)
      end
    end
  end
end
