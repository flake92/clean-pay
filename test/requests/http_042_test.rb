require "test_helper"

class Http042Test < ActionDispatch::IntegrationTest
  test "consumes OIDC ceremony and creates Rails session" do
    state, secrets = TelegramAuthState.issue!(redirect_to: "/cabinet")
    install_ceremony_cookies(secrets)
    identity = telegram_identity
    oidc = FakeOidcClient.new(identity:, secrets:)
    authentication = Minitest::Mock.new
    result = telegram_result
    authentication.expect(:oidc!, result, [ identity ])

    Integrations::TelegramOidcClient.stub(:new, oidc) do
      Identity::TelegramAuthentication.stub(:new, authentication) do
        get callback_account_telegram_authorization_path,
          params: { code: "authorization-code", state: secrets.state }
      end
    end

    assert_redirected_to "/cabinet"
    assert state.reload.consumed_at
    assert cookies[:clean_pay_access].present?
    assert cookies[:clean_pay_tg_state].blank?
    assert oidc.exchanged
    assert oidc.verified
    authentication.verify
  end

  class FakeOidcClient
    attr_reader :exchanged, :verified

    def initialize(identity:, secrets:)
      @identity = identity
      @secrets = secrets
    end

    def exchange(code:, verifier:)
      raise unless code == "authorization-code" && verifier == @secrets.verifier

      @exchanged = true
      "verified-id-token"
    end

    def verify(token, nonce:)
      raise unless token == "verified-id-token" && nonce == @secrets.nonce

      @verified = true
      @identity
    end
  end

  private

  def install_ceremony_cookies(secrets)
    cookies[:clean_pay_tg_state] = secrets.state
    cookies[:clean_pay_tg_nonce] = secrets.nonce
    cookies[:clean_pay_tg_code_verifier] = secrets.verifier
  end

  def telegram_identity
    Integrations::TelegramPayload::Identity.new(
      id: "123456",
      first_name: "Alex",
      last_name: nil,
      username: "alex",
      photo_url: nil,
      auth_date: Time.current.to_i
    )
  end

  def telegram_result
    user = create_web_user(telegram_id: "123456")
    tokens = Identity::SessionAuthenticator.new.issue!(
      web_user: user,
      auth_method: :telegram
    )
    Identity::TelegramAuthentication::Result.new(
      web_user: user,
      tokens:,
      profile: {},
      upstream_auth: nil
    )
  end
end
