require "test_helper"

class Http004Test < ActionDispatch::IntegrationTest
  test "routes a current Rails session to the server-rendered profile" do
    user = create_web_user(telegram_id: "12345")
    sign_in_as(user)

    get "/account/session"

    assert_redirected_to profile_path
  end

  test "routes a guest to the login page" do
    get "/account/session"

    assert_redirected_to login_path
  end
end
