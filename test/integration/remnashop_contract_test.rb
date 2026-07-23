require "test_helper"

class RemnashopContractTest < ActiveSupport::TestCase
  class RecordingHttp
    attr_reader :calls

    def initialize(auth: false)
      @auth = auth
      @calls = []
    end

    def request(method, path, **options)
      calls << [ method, path, options ]
      headers =
        if @auth
          {
            "set-cookie" => [
              "access_token=#{JWT.encode({ "sub" => "42" }, nil, "none")}; Path=/",
              "refresh_token=refresh-proof; Path=/"
            ]
          }
        else
          {}
        end
      Integrations::HttpClient::Response.new(
        status: 200,
        headers:,
        body: {}
      )
    end
  end

  test "RS-012 returns the preserved public plan catalog" do
    result = Integrations::RemnashopClient.new.public_plans

    assert_kind_of Hash, result
    assert_kind_of Array, result.fetch("plans")
  end

  test "RS-001 through RS-011 preserve every identity and mail operation" do
    public_http = RecordingHttp.new(auth: true)
    client = Integrations::RemnashopClient.new(
      public_http:,
      admin_http: RecordingHttp.new,
      config: configured
    )
    telegram = {
      id: 42,
      first_name: "Test",
      auth_date: Time.current.to_i,
      hash: "a" * 64
    }

    client.register(email: "user@example.test", password: "Password1!")
    client.login(email: "user@example.test", password: "Password1!")
    client.telegram_auth(telegram)
    client.telegram_webapp(init_data: "signed-init-data")
    client.refresh(refresh_token: "refresh-token")
    client.change_password(
      access_token: "access-token",
      payload: {
        current_password: "Password1!",
        new_password: "Password2!"
      }
    )
    client.me(access_token: "access-token")
    client.link_telegram(access_token: "access-token", payload: telegram)
    client.request_email_verification(
      access_token: "access-token",
      email: "next@example.test"
    )
    client.confirm_email(access_token: "access-token", code: "123456")
    client.change_email(
      access_token: "access-token",
      email: "next@example.test"
    )

    assert_equal [
      [ :post, "auth/register" ],
      [ :post, "auth/login" ],
      [ :post, "auth/telegram" ],
      [ :post, "auth/telegram/webapp" ],
      [ :post, "auth/refresh" ],
      [ :post, "auth/change-password" ],
      [ :get, "auth/me" ],
      [ :post, "auth/telegram/link" ],
      [ :post, "auth/email/request-verification" ],
      [ :post, "auth/email/confirm" ],
      [ :post, "auth/email/change" ]
    ], public_http.calls.map { |method, path, _| [ method, path ] }
    assert_equal "refresh_token=refresh-token",
      public_http.calls[4][2].fetch(:headers).fetch("Cookie")
    assert_equal "access_token=access-token",
      public_http.calls[5][2].fetch(:headers).fetch("Cookie")
    assert_equal({ code: "123456" },
      public_http.calls[9][2].fetch(:json))
  end

  test "RS-013 through RS-021 preserve subscription mutation boundaries" do
    public_http = RecordingHttp.new
    client = Integrations::RemnashopClient.new(
      public_http:,
      admin_http: RecordingHttp.new,
      config: configured
    )

    client.current_subscription(access_token: "access")
    client.offers(access_token: "access")
    client.purchase(
      access_token: "access",
      idempotency_key: "purchase-key",
      payload: { plan_code: "BASIC", duration_days: 30 }
    )
    client.extend_subscription(
      access_token: "access",
      idempotency_key: "extend-key",
      payload: { duration_days: 30 }
    )
    client.reissue(access_token: "access")
    client.activate_promocode(access_token: "access", code: "PROMO")
    client.devices(access_token: "access")
    client.delete_devices(access_token: "access")
    client.delete_device(access_token: "access", hwid: "device/a b")

    assert_equal [
      [ :get, "subscription/current" ],
      [ :get, "subscription/offers" ],
      [ :post, "subscription/purchase" ],
      [ :post, "subscription/extend" ],
      [ :post, "subscription/reissue" ],
      [ :post, "subscription/promocode" ],
      [ :get, "subscription/devices" ],
      [ :delete, "subscription/devices" ],
      [ :delete, "subscription/devices/device%2Fa%20b" ]
    ], public_http.calls.map { |method, path, _| [ method, path ] }
    assert_equal "purchase-key",
      public_http.calls[2][2].fetch(:headers).fetch("Idempotency-Key")
    assert_equal "extend-key",
      public_http.calls[3][2].fetch(:headers).fetch("Idempotency-Key")
  end

  test "RS-022 through RS-027 preserve history and public recovery paths" do
    public_http = RecordingHttp.new
    client = Integrations::RemnashopClient.new(
      public_http:,
      admin_http: RecordingHttp.new,
      config: configured
    )

    client.capabilities(access_token: "access")
    client.transaction_page(access_token: "access", limit: 25,
      cursor: "next cursor")
    client.transaction(access_token: "access", payment_id: "pay/id")
    client.transactions(access_token: "access")
    client.payment_recovery(
      access_token: "access",
      operation: "PURCHASE",
      idempotency_key: "read-key"
    )
    client.payment_recovery(
      access_token: "access",
      operation: "EXTEND",
      idempotency_key: "trigger-key",
      trigger: true
    )

    assert_equal [
      [ :get, "subscription/capabilities" ],
      [ :get, "subscription/transactions/page?limit=25&cursor=next+cursor" ],
      [ :get, "subscription/transactions/by-id/pay%2Fid" ],
      [ :get, "subscription/transactions" ],
      [ :get, "subscription/payment-operations/PURCHASE" ],
      [ :post, "subscription/payment-operations/EXTEND" ]
    ], public_http.calls.map { |method, path, _| [ method, path ] }
  end

  test "RS-028 through RS-030 preserve admin key and recovery paths" do
    admin_http = RecordingHttp.new
    client = Integrations::RemnashopClient.new(
      public_http: RecordingHttp.new,
      admin_http:,
      config: configured
    )

    client.merge_users(
      payload: { source_user_id: 1, target_user_id: 2 },
      dry_run: true
    )
    client.admin_payment_recovery(
      operation: "PURCHASE",
      user_id: "owner/id",
      idempotency_key: "read-key"
    )
    client.admin_payment_recovery(
      operation: "EXTEND",
      user_id: "owner/id",
      idempotency_key: "trigger-key",
      trigger: true
    )

    assert_equal [
      [ :post, "users/merge?dry_run=true" ],
      [ :get, "payment-operations/PURCHASE?user_id=owner%2Fid" ],
      [ :post, "payment-operations/EXTEND?user_id=owner%2Fid" ]
    ], admin_http.calls.map { |method, path, _| [ method, path ] }
    admin_http.calls.each do |_, _, options|
      assert_equal "dev-remnashop-api-key-change-me",
        options.fetch(:headers).fetch("X-API-Key")
    end
  end

  private

  def configured
    original = Rails.application.config.x.clean_pay
    remnashop = original.remnashop.with(
      api_key:
        CleanPay::AppConfig::Secret.new("dev-remnashop-api-key-change-me")
    )
    Object.new.tap do |wrapper|
      wrapper.define_singleton_method(:remnashop) { remnashop }
    end
  end
end
