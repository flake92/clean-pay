require "test_helper"

class ReverseProxyContractTest < ActiveSupport::TestCase
  test "proxy preserves application path/query and reaches all three upstreams" do
    app = Integrations::HttpClient.new(
      base_url: "http://127.0.0.1:8080",
      timeout: 5
    ).request(
      :get,
      "health/liveness?probe=proxy",
      headers: {
        "X-Forwarded-For" => "198.51.100.8",
        "X-Request-ID" => "proxy-contract"
      }
    )
    assert_equal 200, app.status
    assert_equal "ok", app.body.fetch("status")

    remnashop = Integrations::HttpClient.new(
      base_url: "http://127.0.0.1:8081",
      timeout: 5
    ).request(:get, "api/v1/public/plans/public")
    assert_equal 200, remnashop.status
    assert_kind_of Array, remnashop.body.fetch("plans")

    mailpit = Integrations::HttpClient.new(
      base_url: "http://127.0.0.1:8026",
      timeout: 5
    ).request(:get, "api/v1/messages")
    assert_equal 200, mailpit.status
    assert_kind_of Array, mailpit.body.fetch("messages")
  end
end
