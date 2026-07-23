require "application_system_test_case"

class Page015Test < ApplicationSystemTestCase
  test "renders independent email and password profile forms" do
    sign_in_browser
    assert_page profile_path, "Профиль"
    assert_field "Новый e-mail"
    assert_field "Текущий пароль", type: "password"
  end
end
