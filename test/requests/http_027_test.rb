require "test_helper"

class Http027Test < ActionDispatch::IntegrationTest
  test "activates form promocode and redirects to subscription" do
    tokens = sign_in_with_upstream
    operation = Minitest::Mock.new
    operation.expect(
      :activate_promocode,
      { "success" => true, "reward_type" => "TRAFFIC" },
      [],
      web_session: tokens.web_session,
      code: "PROMO-2026"
    )

    Subscriptions::AccountActions.stub(:new, operation) do
      post promocode_subscription_path,
        params: { promocode: { code: "PROMO-2026" } }
    end

    assert_redirected_to subscription_path
    assert_equal "Промокод применён.", flash[:notice]
    operation.verify
  end
end
