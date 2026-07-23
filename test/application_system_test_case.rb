require "test_helper"

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  driven_by :rack_test

  OFFERS = {
    "plans" => [
      {
        "id" => "plan-1",
        "public_code" => "basic",
        "name" => "Базовый",
        "description" => "Доступ на один месяц",
        "monthly_from_rub" => "199",
        "recommended_purchase_type" => "RENEW",
        "durations" => [
          {
            "days" => 30,
            "prices" => [
              {
                "gateway_type" => "CARD",
                "final_amount" => "199.00",
                "currency" => "RUB"
              }
            ]
          }
        ]
      }
    ]
  }.freeze

  private

  def sign_in_browser(
    web_user: create_web_user,
    assurance_level: :full,
    upstream: false
  )
    tokens = Identity::SessionAuthenticator.new.issue!(
      web_user:,
      auth_method: :email,
      assurance_level:
    )
    if upstream
      tokens.web_session.update!(
        remnashop_access_token: "upstream-access",
        remnashop_refresh_token: "upstream-refresh",
        remnashop_access_token_expires_at: 15.minutes.from_now,
        remnashop_refresh_token_expires_at: 30.days.from_now
      )
    end
    page.driver.browser.set_cookie("clean_pay_access=#{tokens.access_token}")
    page.driver.browser.set_cookie("clean_pay_refresh=#{tokens.refresh_token}")
    tokens
  end

  def with_offers
    catalog = Object.new
    catalog.define_singleton_method(:offers) { |**| OFFERS }
    catalog.define_singleton_method(:public_plans) { OFFERS }
    Subscriptions::Catalog.stub(:new, catalog) { yield }
  end

  def with_empty_subscription
    access = Object.new
    access.define_singleton_method(:call) { |**| nil }
    Subscriptions::CurrentAccess.stub(:new, -> { access }) { yield }
  end

  def assert_page(path, heading)
    visit path
    assert_text heading
    assert_selector "html[lang='ru']"
    assert_no_selector "script[src*='localhost']"
  end
end
