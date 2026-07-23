require "application_system_test_case"

class Page019Test < ApplicationSystemTestCase
  test "renders a privacy-safe offline fallback" do
    assert_page offline_path, "Clean Pay сейчас офлайн"
    assert_text "не сохранены"
  end
end
