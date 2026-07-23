require "application_system_test_case"

class Page009Test < ApplicationSystemTestCase
  test "renders the public plan catalog" do
    with_offers do
      assert_page tariffs_path, "Тарифы"
      assert_text "Базовый"
    end
  end
end
