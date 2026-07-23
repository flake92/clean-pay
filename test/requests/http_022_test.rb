require "test_helper"

class Http022Test < ActionDispatch::IntegrationTest
  test "renders current subscription with verified live URL" do
    tokens = sign_in_with_upstream
    operation = FakeCurrentAccess.new(
      value: {
        "status" => "ACTIVE",
        "plan_name" => "Премиум",
        "url" => "https://live.example.test/connect"
      },
      expected_session: tokens.web_session
    )

    Subscriptions::CurrentAccess.stub(:new, -> { operation }) do
      get subscription_path
    end

    assert_response :success
    assert_select "h1", "Подписка"
    assert_select "a[href=?]", "https://live.example.test/connect"
    assert operation.called
  end

  test "renders ordinary empty state when subscription is absent" do
    tokens = sign_in_with_upstream
    operation = FakeCurrentAccess.new(
      value: nil,
      expected_session: tokens.web_session
    )

    Subscriptions::CurrentAccess.stub(:new, -> { operation }) do
      get subscription_path
    end

    assert_response :success
    assert_includes response.body, "Активной подписки пока нет."
    assert operation.called
  end

  class FakeCurrentAccess
    attr_reader :called

    def initialize(value:, expected_session:)
      @value = value
      @expected_session = expected_session
    end

    def call(web_session:)
      raise unless web_session == @expected_session

      @called = true
      @value
    end
  end
end
