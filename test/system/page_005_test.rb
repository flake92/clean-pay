require "application_system_test_case"

class Page005Test < ApplicationSystemTestCase
  test "renders email verification for an incomplete account" do
    user = create_web_user(email_verified: false)
    sign_in_browser(web_user: user)
    assert_page verify_email_path, "Подтвердите e-mail"
    assert_text user.email
  end
end
