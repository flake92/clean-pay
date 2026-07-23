require "test_helper"

class Http034Test < ActionDispatch::IntegrationTest
  test "returns process health without probing dependencies" do
    get health_path

    assert_response :success
    assert_equal "application/json", response.media_type
    assert_equal "ok", parsed_response.fetch("status")
    assert_equal "clean-pay", parsed_response.fetch("service")
    assert parsed_response.fetch("version").present?
  end
end
