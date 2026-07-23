require "test_helper"

class Http035Test < ActionDispatch::IntegrationTest
  test "returns the same static liveness contract" do
    get liveness_health_path

    assert_response :success
    assert_equal "ok", parsed_response.fetch("status")
    assert_equal "clean-pay", parsed_response.fetch("service")
  end
end
