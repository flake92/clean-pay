require "application_system_test_case"

class Page002Test < ApplicationSystemTestCase
  test "renders email, Telegram and Passkey login choices" do
    assert_page login_path, "Вход в кабинет"
    assert_field "E-mail"
    assert_button "Войти с Passkey"
  end
end
