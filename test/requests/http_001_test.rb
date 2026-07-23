require "test_helper"

class Http001Test < ActionDispatch::IntegrationTest
  test "routes a known normalized e-mail to the Rails login form" do
    create_web_user(email: "person@example.test")

    post "/account/identity",
      params: { identity: { email: " PERSON@EXAMPLE.TEST ", ignored: true } }

    assert_redirected_to login_path(
      email: "person@example.test",
      mode: "password"
    )
  end

  test "routes an unknown e-mail to the Rails registration form" do
    post "/account/identity",
      params: { identity: { email: "new@example.test" } }

    assert_redirected_to login_path(
      email: "new@example.test",
      mode: "register"
    )
  end
end
