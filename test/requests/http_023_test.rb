require "test_helper"

class Http023Test < ActionDispatch::IntegrationTest
  test "renders personal offers through Rails" do
    tokens = sign_in_with_upstream
    catalog = Minitest::Mock.new
    catalog.expect(
      :offers,
      {
        "gateways" => [],
        "plans" => [ { "name" => "Персональный" } ],
        "has_current_subscription" => true,
        "current_subscription_status" => "ACTIVE"
      },
      [],
      web_session: tokens.web_session
    )

    Subscriptions::Catalog.stub(:new, catalog) do
      get offers_subscription_path
    end

    assert_response :success
    assert_select "h1", "Доступные предложения"
    assert_includes response.body, "Персональный"
    catalog.verify
  end
end
