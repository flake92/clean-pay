require "test_helper"

class AppConfigTest < ActiveSupport::TestCase
  test "provides safe development defaults with typed values" do
    config = CleanPay::AppConfig.load(env: {}, production: false)

    assert_equal URI("http://localhost:4000"), config.urls.app
    assert_equal URI("redis://127.0.0.1:6379/0"), config.storage.redis
    assert_equal 4000, config.runtime.port
    assert_equal false, config.cookies.secure
    assert_equal :lax, config.cookies.same_site
    assert_equal 180, config.retention.audit_info_days
    assert_equal 365, config.retention.audit_security_days
  end

  test "rejects non-strict booleans and invalid cookie combinations" do
    assert_raises(CleanPay::ConfigurationError) do
      CleanPay::AppConfig.load(env: { "COOKIE_SECURE" => "yes" }, production: false)
    end

    error = assert_raises(CleanPay::ConfigurationError) do
      CleanPay::AppConfig.load(
        env: { "COOKIE_SECURE" => "false", "COOKIE_SAMESITE" => "none" },
        production: false
      )
    end
    assert_match(/COOKIE_SAMESITE=none requires COOKIE_SECURE=true/, error.message)
  end

  test "enforces bounded and ordered retention settings" do
    error = assert_raises(CleanPay::ConfigurationError) do
      CleanPay::AppConfig.load(
        env: {
          "AUDIT_INFO_RETENTION_DAYS" => "400",
          "AUDIT_SECURITY_RETENTION_DAYS" => "365"
        },
        production: false
      )
    end

    assert_match(/AUDIT_SECURITY_RETENTION_DAYS/, error.message)
  end

  test "requires complete feature configuration when optional integrations are enabled" do
    assert_raises(CleanPay::ConfigurationError) do
      CleanPay::AppConfig.load(env: { "TURNSTILE_ENABLED" => "true" }, production: false)
    end

    assert_raises(CleanPay::ConfigurationError) do
      CleanPay::AppConfig.load(
        env: { "PAYMENT_RECONCILIATION_ENABLED" => "true" },
        production: false
      )
    end
  end

  test "redacts secret wrappers from inspection" do
    secret = "development-secret-with-32-characters"
    config = CleanPay::AppConfig.load(
      env: { "WEB_JWT_SECRET" => secret },
      production: false
    )

    refute_includes config.inspect, secret
    assert_equal secret, config.security.jwt_secret.value
  end

  test "accepts a complete production configuration" do
    config = CleanPay::AppConfig.load(env: production_env, production: true)

    assert_equal "https://clean-pay.example", config.urls.app.to_s
    assert_equal true, config.cookies.secure
    assert_equal "123456789", config.telegram.client_id
    assert_equal 4000, config.runtime.port
  end

  test "keeps the checked-in environment example bootable" do
    config = CleanPay::AppConfig.load(
      env: Dotenv.parse(Rails.root.join(".env.example")),
      production: false
    )

    assert_equal URI("http://localhost:4000"), config.urls.app
    assert_equal URI("redis://127.0.0.1:6379/0"), config.storage.redis
    assert_equal 4000, config.runtime.port
  end

  test "rejects reused production secrets" do
    env = production_env
    env["WEB_REFRESH_SECRET"] = env.fetch("WEB_JWT_SECRET")

    error = assert_raises(CleanPay::ConfigurationError) do
      CleanPay::AppConfig.load(env:, production: true)
    end

    assert_match(/pairwise distinct/, error.message)
  end

  private

  def production_env
    {
      "APP_URL" => "https://clean-pay.example",
      "NEXT_PUBLIC_APP_URL" => "https://clean-pay.example",
      "DATABASE_URL" =>
        "postgresql://clean_pay:#{'d' * 24}@postgres.example:5432/clean_pay",
      "REDIS_URL" => "rediss://:#{'c' * 24}@redis.example:6379/0",
      "REMNASHOP_API_BASE_URL" =>
        "https://remnashop.example/api/v1/public",
      "REMNASHOP_API_KEY" => "n" * 24,
      "REMNAWAVE_API_BASE_URL" => "https://remnawave.example",
      "REMNAWAVE_TOKEN" => "w" * 24,
      "WEB_JWT_SECRET" => "j" * 32,
      "WEB_REFRESH_SECRET" => "r" * 32,
      "AUDIT_IP_HASH_SECRET" => "a" * 32,
      "RATE_LIMIT_IDENTITY_SECRET" => "l" * 32,
      "READINESS_INTERNAL_SECRET" => "i" * 32,
      "COOKIE_SECURE" => "true",
      "TELEGRAM_OIDC_CLIENT_ID" => "123456789",
      "TELEGRAM_OIDC_CLIENT_SECRET" => "o" * 24,
      "TELEGRAM_BOT_TOKEN" => "123456789:#{'t' * 24}"
    }
  end
end
