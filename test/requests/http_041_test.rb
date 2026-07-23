require "test_helper"

class Http041Test < ActionDispatch::IntegrationTest
  test "starts OIDC ceremony with server state and secure cookies" do
    oidc = Minitest::Mock.new
    oidc.expect(
      :authorization_url,
      "https://oauth.telegram.org/auth?request=test",
      state: String,
      nonce: String,
      verifier: String
    )

    Integrations::TelegramOidcClient.stub(:new, oidc) do
      get new_account_telegram_authorization_path,
        params: { redirect_to: "/cabinet" }
    end

    assert_response :found
    assert_redirected_to "https://oauth.telegram.org/auth?request=test"
    assert_equal 1, TelegramAuthState.count
    assert_equal "/cabinet", TelegramAuthState.last.redirect_to
    assert cookies[:clean_pay_tg_state].present?
    assert cookies[:clean_pay_tg_nonce].present?
    assert cookies[:clean_pay_tg_code_verifier].present?
    oidc.verify
  end
end
