require "test_helper"

class Subscriptions::CurrentAccessTest < ActiveSupport::TestCase
  test "replaces stored URL with authoritative active Remnawave URL" do
    user = create_web_user(
      remnashop_user_id: "remna-42",
      telegram_id: "42"
    )
    session = upstream_session(user)
    shop = FakeShop.new(
      "user_remna_id" => "remna-42",
      "status" => "ACTIVE",
      "url" => "https://stale.example.test"
    )
    wave = FakeWave.new(
      direct: {
        "uuid" => "remna-42",
        "status" => "ACTIVE",
        "expireAt" => 1.day.from_now.iso8601,
        "subscriptionUrl" => "https://live.example.test/connect"
      }
    )

    result = Subscriptions::CurrentAccess.new(shop:, wave:).call(
      web_session: session
    )

    assert_equal "https://live.example.test/connect", result.fetch("url")
    assert_not_equal "https://stale.example.test", result.fetch("url")
    assert_empty wave.fallback_queries
  end

  test "accepts exactly one identity fallback and rejects ambiguity" do
    user = create_web_user(
      email: "owner@example.test",
      telegram_id: "42"
    )
    session = upstream_session(user)
    shop = FakeShop.new(
      "user_remna_id" => "missing",
      "status" => "ACTIVE"
    )
    candidate = {
      "uuid" => "resolved",
      "status" => "ACTIVE",
      "email" => user.email,
      "telegramId" => user.telegram_id,
      "subscriptionUrl" => "https://live.example.test/one"
    }
    wave = FakeWave.new(
      direct: nil,
      email: [ candidate ],
      telegram: [ candidate ]
    )

    result = Subscriptions::CurrentAccess.new(shop:, wave:).call(
      web_session: session
    )
    assert_equal "https://live.example.test/one", result.fetch("url")

    wave = FakeWave.new(
      direct: nil,
      email: [ candidate ],
      telegram: [
        candidate.merge(
          "uuid" => "other",
          "subscriptionUrl" => "https://live.example.test/two"
        )
      ]
    )
    assert_raises(Subscriptions::CurrentAccess::UrlUnavailableError) do
      Subscriptions::CurrentAccess.new(shop:, wave:).call(
        web_session: session
      )
    end
  end

  test "does not query Remnawave for an absent subscription" do
    user = create_web_user
    session = upstream_session(user)
    wave = Minitest::Mock.new

    result = Subscriptions::CurrentAccess.new(
      shop: FakeShop.new(nil),
      wave:
    ).call(web_session: session)

    assert_nil result
    wave.verify
  end

  class FakeShop
    def initialize(subscription)
      @subscription = subscription
    end

    def current_subscription(*) = @subscription
  end

  class FakeWave
    attr_reader :fallback_queries

    def initialize(direct:, email: [], telegram: [])
      @direct = direct
      @email = email
      @telegram = telegram
      @fallback_queries = []
    end

    def user(*) = @direct

    def users_by_email(email)
      @fallback_queries << [ :email, email ]
      @email
    end

    def users_by_telegram_id(telegram_id)
      @fallback_queries << [ :telegram, telegram_id ]
      @telegram
    end
  end

  private

  def upstream_session(user)
    create_web_session(
      web_user: user,
      remnashop_access_token: "upstream-access",
      remnashop_refresh_token: "upstream-refresh",
      remnashop_access_token_expires_at: 15.minutes.from_now,
      remnashop_refresh_token_expires_at: 30.days.from_now
    )
  end
end
