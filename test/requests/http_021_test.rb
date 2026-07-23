require "test_helper"

class Http021Test < ActionDispatch::IntegrationTest
  test "renders public plans as HTML without a BFF envelope" do
    catalog = Minitest::Mock.new
    catalog.expect(
      :public_plans,
      {
        "plans" => [
          {
            "name" => "Базовый",
            "description" => "<script>alert(1)</script>"
          }
        ]
      }
    )

    Subscriptions::Catalog.stub(:new, catalog) { get plans_path }

    assert_response :success
    assert_equal "text/html", response.media_type
    assert_select "h1", "Тарифы"
    assert_includes response.body, "Базовый"
    assert_not_includes response.body, "<script>alert(1)</script>"
    catalog.verify
  end
end
