require "application_system_test_case"

class Page012Test < ApplicationSystemTestCase
  test "treats provider success only as a hint" do
    sign_in_browser
    assert_page payment_success_path, "Проверяем оплату"
    assert_text "только подсказка"
  end
end
