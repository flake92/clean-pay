require "application_system_test_case"

class Page001Test < ApplicationSystemTestCase
  test "renders the public home action cards" do
    assert_page root_path, "Web-кабинет для оплаты"
    assert_link "Тарифы", href: tariffs_path
  end
end
