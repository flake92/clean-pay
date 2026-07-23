require "application_system_test_case"

class Page014Test < ApplicationSystemTestCase
  test "renders the bounded pending state" do
    sign_in_browser
    assert_page payment_pending_path, "Операция обрабатывается"
    assert_link "Обновить состояние"
  end
end
