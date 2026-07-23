require "application_system_test_case"

class Page013Test < ApplicationSystemTestCase
  test "does not claim final failure from the provider return" do
    sign_in_browser
    assert_page payment_fail_path, "Результат уточняется"
    assert_text "Не создавайте повторный платёж"
  end
end
