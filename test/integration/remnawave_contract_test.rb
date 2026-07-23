require "test_helper"

class RemnawaveContractTest < ActiveSupport::TestCase
  test "preserved mock satisfies safe absence and readiness contracts" do
    client = Integrations::RemnawaveClient.new(
      http: Integrations::HttpClient.new(
        base_url: "http://127.0.0.1:3001",
        timeout: 5
      ),
      readiness_http: Integrations::HttpClient.new(
        base_url: "http://127.0.0.1:3001",
        timeout: 5
      ),
      config: configured_app
    )

    assert_nil client.user("missing-user")
    assert_empty client.users_by_email("missing@example.test")
    assert_empty client.users_by_telegram_id("42")
    assert_predicate client, :ready?
  end

  private

  def configured_app
    current = Rails.application.config.x.clean_pay
    configured = current.dup
    configured.instance_variable_set(
      :@remnawave,
      current.remnawave.with(
        api: URI("http://127.0.0.1:3001"),
        token: CleanPay::AppConfig::Secret.new("test-remnawave-token")
      )
    )
    configured.instance_variable_set(
      :@readiness,
      current.readiness.with(
        remnawave_url: URI("http://127.0.0.1:3001")
      )
    )
    configured
  end
end
