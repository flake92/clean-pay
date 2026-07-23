require "application_system_test_case"

class Page009Test < ApplicationSystemTestCase
  test "renders the public plan catalog" do
    sign_in_browser(upstream: true)
    with_offers do
      assert_page tariffs_path, "Тарифы"
      assert_text "Базовый"
      assert_link "Выбрать",
        href: purchase_page_path(
          plan_code: "basic",
          duration_days: 30,
          gateway_type: "CARD"
        )
    end
  end
end
