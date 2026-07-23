require "application_system_test_case"

class Page010Test < ApplicationSystemTestCase
  test "renders a server-confirmed purchase form" do
    sign_in_browser(upstream: true)
    with_offers do
      assert_page purchase_page_path(plan_code: "basic"), "Подтвердите тариф"
      assert_button "Перейти к оплате"
      assert_field "purchase[submission_token]", type: "hidden"
    end
  end
end
