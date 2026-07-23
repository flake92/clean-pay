require "test_helper"

class Http016Test < ActionDispatch::IntegrationTest
  test "creates Telegram WebApp session and redirects through Rails" do
    result = telegram_result
    authentication = Minitest::Mock.new
    authentication.expect(:webapp!, result, init_data: "signed-init-data")

    Identity::TelegramAuthentication.stub(:new, authentication) do
      post account_telegram_session_path, params: {
        telegram_session: {
          init_data: " signed-init-data ",
          redirect_to: "/cabinet"
        }
      }
    end

    assert_redirected_to "/cabinet"
    assert cookies[:clean_pay_access].present?
    assert cookies[:clean_pay_refresh].present?
    authentication.verify
  end

  test "rejects blank WebApp proof without external authentication" do
    post account_telegram_session_path, params: {
      telegram_session: { init_data: " " }
    }

    assert_redirected_to root_path
    assert_equal "Проверьте введённые данные.", flash[:alert]
  end

  private

  def telegram_result
    user = create_web_user(telegram_id: SecureRandom.random_number(10**10).to_s)
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
