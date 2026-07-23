require "application_system_test_case"

class Page008Test < ApplicationSystemTestCase
  test "renders independent empty cabinet states" do
    sign_in_browser(upstream: true)
    with_empty_subscription do
      assert_page cabinet_path, "Личный кабинет"
      assert_text "Подписка не активна"
      assert_text "Платежей пока нет"
    end
  end
end
