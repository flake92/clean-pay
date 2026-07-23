require "test_helper"
require "net/http"

class TelegramOidcContractTest < ActiveSupport::TestCase
  OIDC_BASE = "http://127.0.0.1:8090"

  test "TG-001 through TG-003 complete the real PKCE OIDC mock ceremony" do
    Rails.cache.delete("telegram:oidc:jwks")
    client = Integrations::TelegramOidcClient.new(config: configured)
    verifier = Base64.urlsafe_encode64(SecureRandom.random_bytes(48),
      padding: false)
    nonce = SecureRandom.hex(24)
    authorization = URI(client.authorization_url(
      state: "state-proof",
      nonce:,
      verifier:
    ))

    assert_equal "/auth", authorization.path
    assert_equal "S256", authorization.query.then {
      URI.decode_www_form(_1).to_h.fetch("code_challenge_method")
    }

    redirect = Net::HTTP.get_response(authorization)
    assert_equal "302", redirect.code
    callback = URI(redirect.fetch("location"))
    assert_equal "state-proof",
      URI.decode_www_form(callback.query).to_h.fetch("state")

    code = URI.decode_www_form(callback.query).to_h.fetch("code")
    id_token = client.exchange(code:, verifier:)
    identity = client.verify(id_token, nonce:)

    assert_equal "100000001", identity.id
    assert_equal "Dev", identity.first_name
    assert_nil identity.username
    assert_raises(Integrations::TelegramOidcClient::Error) do
      client.verify(id_token, nonce: "wrong-nonce")
    end
  ensure
    Rails.cache.delete("telegram:oidc:jwks")
  end

  test "TG-004 and TG-005 verify HMAC age and produce Remnashop payload" do
    token = "0000000000:test-telegram-bot-token"
    now = Time.current
    source = {
      "id" => "100000001",
      "first_name" => "Dev",
      "username" => "dev_user",
      "auth_date" => now.to_i.to_s
    }
    signed = source.merge(
      "hash" => Integrations::TelegramPayload.signature(source,
        bot_token: token)
    )

    identity = Integrations::TelegramPayload.verify(
      signed,
      bot_token: token,
      at: now
    )
    upstream = identity.to_remnashop(bot_token: token, at: now)

    assert_equal 100000001, upstream.fetch("id")
    assert_match(/\A[0-9a-f]{64}\z/, upstream.fetch("hash"))
    assert_raises(Integrations::TelegramPayload::InvalidError) do
      Integrations::TelegramPayload.verify(
        signed.merge("auth_date" => 25.hours.ago(now).to_i.to_s),
        bot_token: token,
        at: now
      )
    end
  end

  private

  def configured
    original = Rails.application.config.x.clean_pay
    telegram = original.telegram.with(
      client_id: "dev-telegram-client-id",
      client_secret:
        CleanPay::AppConfig::Secret.new("dev-telegram-client-secret"),
      bot_token:
        CleanPay::AppConfig::Secret.new("0000000000:test-telegram-bot-token"),
      issuer: URI("http://telegram-oidc-mock:8090"),
      authorization_endpoint: URI("#{OIDC_BASE}/auth"),
      token_endpoint: URI("#{OIDC_BASE}/token"),
      jwks_uri: URI("#{OIDC_BASE}/.well-known/jwks.json")
    )
    Object.new.tap do |wrapper|
      wrapper.define_singleton_method(:telegram) { telegram }
      wrapper.define_singleton_method(:urls) do
        CleanPay::AppConfig::Urls.new(
          app: URI("http://localhost:4000"),
          public_app: URI("http://localhost:4000")
        )
      end
    end
  end
end
