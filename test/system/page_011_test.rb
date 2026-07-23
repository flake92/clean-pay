require "application_system_test_case"

class Page011Test < ApplicationSystemTestCase
  test "renders the normative no-subscription state" do
    sign_in_browser(upstream: true)
    with_empty_subscription do
      assert_page extend_path, "Продление подписки"
      assert_text "Подписка не активна"
      assert_link "Выбрать тариф", href: tariffs_path
      assert_no_button "Продлить"
    end
  end

  test "renders a server-confirmed extension form" do
    sign_in_browser(upstream: true)
    access = Object.new
    access.define_singleton_method(:call) do |**|
      {
        "plan_name" => "Базовый",
        "expire_at" => "2026-08-01T00:00:00Z"
      }
    end
    Subscriptions::CurrentAccess.stub(:new, -> { access }) do
      with_offers do
        assert_page extend_path, "Продление подписки"
        assert_text "Текущая подписка"
        assert_text "199.00 RUB"
        assert_button "Продлить"
      end
    end
  end
end
