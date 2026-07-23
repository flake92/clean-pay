require "test_helper"

class Http037Test < ActionDispatch::IntegrationTest
  test "hides the internal readiness resource from a wrong secret" do
    get internal_health_readiness_path,
      headers: { "X-Clean-Pay-Readiness-Secret" => "wrong" }

    assert_response :not_found
    assert_empty response.body
  end

  test "returns sanitized dependency details to an authenticated operator" do
    secret = "readiness-test-secret-32-characters"
    result = Platform::ReadinessCheck::Result.new(
      status: "ok",
      checked_at: Time.current,
      checks: {
        "postgresql" => Platform::ReadinessCheck::Check.new(
          status: "ok",
          latency_ms: 2,
          message: nil
        )
      }
    )
    check = Minitest::Mock.new
    check.expect(:call, result)

    original = Rails.application.config.x.clean_pay
    readiness = original.readiness.with(
      internal_secret: CleanPay::AppConfig::Secret.new(secret)
    )
    config = Object.new
    config.define_singleton_method(:readiness) { readiness }
    config.define_singleton_method(:method_missing) do |name, *args, **kwargs,
      &block|
      original.public_send(name, *args, **kwargs, &block)
    end

    Rails.application.config.x.stub(:clean_pay, config) do
      Platform::ReadinessCheck.stub(:new, -> { check }) do
        get internal_health_readiness_path,
          headers: { "X-Clean-Pay-Readiness-Secret" => secret }
      end
    end

    assert_response :success
    assert_equal "ok", parsed_response.fetch("status")
    assert_equal 2, parsed_response.dig("checks", "postgresql", "latencyMs")
    assert_equal "no-store", response.headers["Cache-Control"]
    check.verify
  end
end
