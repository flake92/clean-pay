require "application_system_test_case"

class Page004Test < ApplicationSystemTestCase
  test "renders bootstrap registration verification" do
    user = create_web_user(email_verified: false, auth_pending: true)
    sign_in_browser(web_user: user, assurance_level: :bootstrap)
    assert_page register_verify_email_path, "Подтверждение e-mail"
    assert_field "Код подтверждения"
    assert_button "Подтвердить e-mail"
    assert_button "Отправить код повторно"
    assert_button "Назад"
  end
end
