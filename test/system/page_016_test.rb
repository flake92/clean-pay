require "application_system_test_case"

class Page016Test < ApplicationSystemTestCase
  test "renders separate account-linking methods" do
    sign_in_browser
    assert_page link_account_path, "Способы входа"
    assert_button "Подключить e-mail"
    assert_button "Привязать Telegram"
    assert_button "Добавить Passkey"
  end
end
