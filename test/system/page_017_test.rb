require "application_system_test_case"

class Page017Test < ApplicationSystemTestCase
  test "renders a safe support availability state" do
    sign_in_browser
    assert_page support_path, "Поддержка"
    assert_text(/недоступны|Написать|Telegram|Частые вопросы/)
  end
end
