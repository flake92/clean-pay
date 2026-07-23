require "application_system_test_case"

class PwaPrivacyTest < ApplicationSystemTestCase
  test "installs a build-scoped public shell and keeps private routes out" do
    with_build_id("system-build-123") do
      visit install_path
      assert_text "Установить Clean Pay"
      assert_selector "dialog[aria-labelledby='install-dialog-title']"
      assert_selector "[data-controller~='pwa-install']"

      visit web_app_manifest_path
      assert_includes(
        page.response_headers["Content-Type"],
        "application/manifest+json"
      )
      assert_includes page.body, "/clean-pay-icon-192.png"
      assert_includes page.body, "\"display\": \"standalone\""

      visit "/favicon.ico"
      assert_includes page.response_headers["Content-Type"], "image/"
      assert_operator page.body.bytesize, :>, 1_000

      visit "/service-worker.js"
      assert_equal "no-store", page.response_headers["Cache-Control"]
      assert_equal "/", page.response_headers["Service-Worker-Allowed"]
      assert_includes page.body, "clean-pay-shell-system-build-123"
      assert_includes page.body, "\"/offline\""
      assert_not_includes page.body, "/cabinet"
      assert_not_includes page.body, "/payments"
      assert_not_includes page.body, "/subscription"

      visit offline_path
      assert_text "Clean Pay сейчас офлайн"
      assert_text "Персональные данные не сохранены"

      user = create_web_user(remnashop_user_id: "private-owner")
      sign_in_browser(web_user: user, upstream: true)
      history = Object.new
      history.define_singleton_method(:call!) { |**| [] }
      Payments::SyncHistoryPage.stub(:new, history) { visit payments_path }
      assert_equal "no-store", page.response_headers["Cache-Control"]
      assert_not_includes page.body, "clean-pay-shell-system-build-123"
    end
  end

  private

  def with_build_id(build_id)
    original = Rails.application.config.x.clean_pay
    configured = original.dup
    configured.instance_variable_set(
      :@runtime,
      original.runtime.with(build_id:)
    )
    Rails.application.config.x.stub(:clean_pay, configured) { yield }
  end
end
