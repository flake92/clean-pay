require "test_helper"

class Http043Test < ActionDispatch::IntegrationTest
  test "accepts signed Login Widget form and redirects through Rails" do
    with_telegram_bot_token do
      state, secrets = TelegramAuthState.issue!(redirect_to: "/cabinet")
      install_ceremony_cookies(secrets)
      payload = signed_widget_payload
      authentication = Minitest::Mock.new
      result = telegram_result(payload.fetch("id"))
      authentication.expect(
        :oidc!,
        result,
        [ ->(identity) { identity.id == payload.fetch("id").to_s } ]
      )

      Identity::TelegramAuthentication.stub(:new, authentication) do
        post callback_account_telegram_authorization_path,
          params: payload.merge(state: secrets.state)
      end

      assert_redirected_to "/cabinet"
      assert state.reload.consumed_at
      assert cookies[:clean_pay_access].present?
      authentication.verify
    end
  end

  private

  def install_ceremony_cookies(secrets)
    cookies[:clean_pay_tg_state] = secrets.state
    cookies[:clean_pay_tg_nonce] = secrets.nonce
    cookies[:clean_pay_tg_code_verifier] = secrets.verifier
  end

  def signed_widget_payload
    values = {
      "id" => 987654,
      "first_name" => "Telegram",
      "username" => "telegram_user",
      "auth_date" => Time.current.to_i
    }
    token = Rails.application.config.x.clean_pay.telegram.bot_token&.value
    values.merge(
      "hash" => Integrations::TelegramPayload.signature(values, bot_token: token)
    )
  end

  def with_telegram_bot_token
    current = Rails.application.config.x.clean_pay
    configured = current.dup
    telegram = current.telegram.with(
      bot_token: CleanPay::AppConfig::Secret.new("12345:test-telegram-token")
    )
    configured.instance_variable_set(:@telegram, telegram)
    Rails.application.config.x.stub(:clean_pay, configured) { yield }
  end

  def telegram_result(telegram_id)
    user = create_web_user(telegram_id: telegram_id.to_s)
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
