require "application_system_test_case"

class Page007Test < ApplicationSystemTestCase
  test "allows a verified bootstrap user to skip Passkey" do
    user = create_web_user(auth_pending: true)
    sign_in_browser(
      web_user: user,
      assurance_level: :bootstrap,
      upstream: true
    )
    assert_page passkey_setup_path, "Настройте быстрый вход"
    with_empty_subscription do
      click_button "Продолжить без него"
      assert_current_path cabinet_path
    end
  end
end
