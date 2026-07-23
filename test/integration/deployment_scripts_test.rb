require "test_helper"
require "open3"
require "tempfile"

class DeploymentScriptsTest < ActiveSupport::TestCase
  test "accepts a complete strong production environment" do
    file = env_file(production_environment)

    output, status = run_script("scripts/validate-env.rb", file.path)

    assert_predicate status, :success?, output
    assert_includes output, "Production environment is valid"
  ensure
    file&.close!
  end

  test "rejects duplicate and interpolated assignments" do
    file = env_file("APP_URL=https://clean-pay.example\nAPP_URL=$OTHER\n")

    output, status = run_script("scripts/validate-env.rb", file.path)

    assert_not_predicate status, :success?
    assert_match(/duplicate variable|interpolation is forbidden/, output)
  ensure
    file&.close!
  end

  test "backup and restore require explicit safety arguments" do
    backup_output, backup_status = run_script("scripts/backup.rb")
    restore_output, restore_status = run_script("scripts/restore.rb")

    assert_not_predicate backup_status, :success?
    assert_includes backup_output, "missing --database-url"
    assert_not_predicate restore_status, :success?
    assert_includes restore_output, "missing --database-url"
  end

  private

  def run_script(path, *arguments)
    Open3.capture2e(
      RbConfig.ruby,
      Rails.root.join(path).to_s,
      *arguments
    )
  end

  def env_file(contents)
    Tempfile.new("clean-pay-env").tap do |file|
      file.write(contents)
      file.flush
    end
  end

  def production_environment
    values = {
      "APP_URL" => "https://clean-pay.example.test",
      "NEXT_PUBLIC_APP_URL" => "https://clean-pay.example.test",
      "DATABASE_URL" =>
        "postgresql://clean_pay:local-prestage-database-passphrase@127.0.0.1:5432/clean_pay",
      "POSTGRES_DB" => "clean_pay",
      "POSTGRES_USER" => "clean_pay",
      "POSTGRES_PASSWORD" => "local-prestage-database-passphrase",
      "REDIS_URL" => "redis://127.0.0.1:6379/0",
      "REMNASHOP_API_BASE_URL" =>
        "https://remnashop.example.test/api/v1/public",
      "REMNASHOP_API_KEY" => "remnashop-key-abcdefghijkl",
      "REMNAWAVE_API_BASE_URL" => "https://remnawave.example.test",
      "REMNAWAVE_TOKEN" => "remnawave-token-abcdefghijkl",
      "WEB_JWT_SECRET" => "jwt-abcdefghijklmnopqrstuvwxyz-123",
      "WEB_REFRESH_SECRET" => "refresh-abcdefghijklmnopqrstuvwxyz-123",
      "AUDIT_IP_HASH_SECRET" => "audit-abcdefghijklmnopqrstuvwxyz-123",
      "RATE_LIMIT_IDENTITY_SECRET" => "rate-abcdefghijklmnopqrstuvwxyz-123",
      "READINESS_INTERNAL_SECRET" => "ready-abcdefghijklmnopqrstuvwxyz-123",
      "COOKIE_SECURE" => "true",
      "COOKIE_SAMESITE" => "lax",
      "TELEGRAM_OIDC_CLIENT_ID" => "123456",
      "TELEGRAM_OIDC_CLIENT_SECRET" => "telegram-client-abcdefghijkl",
      "TELEGRAM_BOT_TOKEN" => "123456:telegram-bot-token-abcdefghijkl",
      "TURNSTILE_ENABLED" => "false",
      "SUPPORT_ENABLED" => "false",
      "PAYMENT_RECONCILIATION_ENABLED" => "false",
      "CLEAN_PAY_BIND" => "127.0.0.1",
      "CLEAN_PAY_PORT" => "4000",
      "RUN_MIGRATIONS" => "true",
      "LOG_LEVEL" => "info"
    }
    values.map { |name, value| "#{name}=#{value}" }.join("\n") << "\n"
  end
end
