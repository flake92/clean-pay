require "application_system_test_case"

class Page010Test < ApplicationSystemTestCase
  test "renders the normative missing selection state" do
    sign_in_browser(upstream: true)
    with_offers do
      assert_page purchase_page_path, "Подтверждение оплаты"
      assert_text "Выбранный тариф отсутствует или больше недоступен."
      assert_link "Выбрать тариф", href: tariffs_path
      assert_no_button "Перейти к оплате"
    end
  end

  test "rejects a stale selection" do
    sign_in_browser(upstream: true)
    with_offers do
      assert_page purchase_page_path(
        plan_code: "basic",
        duration_days: 30,
        gateway_type: "MISSING"
      ), "Подтверждение оплаты"
      assert_text "Выбранный тариф отсутствует или больше недоступен."
      assert_no_button "Перейти к оплате"
    end
  end

  test "renders a server-confirmed purchase form" do
    sign_in_browser(upstream: true)
    with_offers do
      assert_page purchase_page_path(
        plan_code: "basic",
        duration_days: 30,
        gateway_type: "CARD"
      ), "Подтверждение оплаты"
      assert_text "30 дн. · CARD"
      assert_text "199.00 RUB"
      assert_button "Перейти к оплате"
      assert_link "Изменить выбор", href: tariffs_path
      assert_field "purchase[submission_token]", type: "hidden"
    end
  end
end
