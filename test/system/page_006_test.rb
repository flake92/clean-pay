require "application_system_test_case"

class Page006Test < ApplicationSystemTestCase
  test "renders the Telegram WebApp boundary" do
    assert_page "/auth/telegram/webapp", "Вход в Clean Pay"
    assert_selector "[data-controller='telegram-webapp']"
  end
end
