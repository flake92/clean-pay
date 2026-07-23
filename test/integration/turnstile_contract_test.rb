require "test_helper"

class TurnstileContractTest < ActiveSupport::TestCase
  test "TS-000 disabled mode performs no external verification" do
    http = Minitest::Mock.new

    assert Integrations::TurnstileClient.new(
      http:,
      config: configured(enabled: false)
    ).verify!(token: nil)
    http.verify
  end

  test "TS-001 sends exact form fields and accepts only the public hostname" do
    response = Integrations::HttpClient::Response.new(
      status: 200,
      headers: {},
      body: { "success" => true, "hostname" => "clean-pay.test" }
    )
    http = Minitest::Mock.new
    http.expect(:request, response) do |method, path, form:|
      method == :post &&
        path == "http://turnstile.test/siteverify" &&
        form == {
          secret: "turnstile-secret",
          response: "browser-proof",
          remoteip: "203.0.113.9"
        }
    end

    assert Integrations::TurnstileClient.new(
      http:,
      config: configured(enabled: true)
    ).verify!(token: "browser-proof", remote_ip: "203.0.113.9")
    http.verify
  end

  test "TS-001 maps missing proof, hostname mismatch and transport failure" do
    client = Integrations::TurnstileClient.new(
      http: Minitest::Mock.new,
      config: configured(enabled: true)
    )
    assert_raises(Integrations::TurnstileClient::ForbiddenError) do
      client.verify!(token: "")
    end

    mismatch = stub_http(
      status: 200,
      body: { "success" => true, "hostname" => "attacker.test" }
    )
    assert_raises(Integrations::TurnstileClient::ForbiddenError) do
      Integrations::TurnstileClient.new(
        http: mismatch,
        config: configured(enabled: true)
      ).verify!(token: "proof")
    end

    unavailable = stub_http(status: 502, body: "bad gateway")
    assert_raises(Integrations::TurnstileClient::UnavailableError) do
      Integrations::TurnstileClient.new(
        http: unavailable,
        config: configured(enabled: true)
      ).verify!(token: "proof")
    end
  end

  private

  def configured(enabled:)
    original = Rails.application.config.x.clean_pay
    turnstile = original.turnstile.with(
      enabled:,
      site_key: enabled ? "turnstile-site" : nil,
      secret_key:
        enabled ? CleanPay::AppConfig::Secret.new("turnstile-secret") : nil,
      verify_url: URI("http://turnstile.test/siteverify")
    )
    Object.new.tap do |wrapper|
      wrapper.define_singleton_method(:turnstile) { turnstile }
      wrapper.define_singleton_method(:urls) do
        CleanPay::AppConfig::Urls.new(
          app: URI("https://clean-pay.test"),
          public_app: URI("https://clean-pay.test")
        )
      end
    end
  end

  def stub_http(status:, body:)
    response = Integrations::HttpClient::Response.new(
      status:,
      headers: {},
      body:
    )
    Object.new.tap do |http|
      http.define_singleton_method(:request) { |*, **| response }
    end
  end
end
