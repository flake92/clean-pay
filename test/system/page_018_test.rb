require "application_system_test_case"

class Page018Test < ApplicationSystemTestCase
  test "renders install guidance" do
    assert_page install_path, "Установить Clean Pay"
    assert_selector "[data-controller='pwa-install']"
  end
end
