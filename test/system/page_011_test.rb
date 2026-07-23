require "application_system_test_case"

class Page011Test < ApplicationSystemTestCase
  test "renders a server-confirmed extension form" do
    sign_in_browser(upstream: true)
    with_offers do
      assert_page extend_path, "Продление"
      assert_button "Продлить"
    end
  end
end
