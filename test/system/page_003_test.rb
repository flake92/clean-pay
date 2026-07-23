require "application_system_test_case"

class Page003Test < ApplicationSystemTestCase
  test "renders the registration fields without retaining passwords" do
    assert_page register_path, "Создать аккаунт"
    assert_field "Повторите пароль", type: "password"
    assert_button "Создать аккаунт"
  end
end
