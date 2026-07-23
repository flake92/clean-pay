require "application_system_test_case"

class Page017Test < ApplicationSystemTestCase
  test "renders a safe support availability state" do
    sign_in_browser
    assert_page support_path, "Поддержка"
    assert_text(/недоступны|Написать|Telegram|FAQ и инструкции/)
    assert_text "Как подключиться"
    assert_text "Для кого этот сайт"
    assert_text "удалите его в кабинете или перевыпустите ссылку"
  end
end
