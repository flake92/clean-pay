require "application_system_test_case"

class Page002Test < ApplicationSystemTestCase
  test "starts with one e-mail field and reveals the correct branch" do
    assert_page login_path, "Вход"
    assert_field "E-mail"
    assert_button "Войти через Telegram"
    assert_no_button "Войти с Passkey"
    assert_no_link "Создать аккаунт"

    fill_in "E-mail", with: "new-person@example.test"
    click_button "Продолжить"

    assert_current_path login_path(
      email: "new-person@example.test",
      mode: "register"
    )
    assert_field "Пароль", type: "password"
    assert_field "Повторите пароль", type: "password"
    assert_button "Создать аккаунт"
    assert_link "Изменить"
  end
end
