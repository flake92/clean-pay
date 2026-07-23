require "test_helper"

class Http028Test < ActionDispatch::IntegrationTest
  test "renders devices and resourceful deletion controls" do
    tokens = sign_in_with_upstream
    operation = Minitest::Mock.new
    operation.expect(
      :list,
      {
        "devices" => [
          {
            "hwid" => "device-1",
            "platform" => "iOS",
            "device_model" => "iPhone"
          }
        ],
        "current_count" => 1,
        "max_count" => 5
      },
      [],
      web_session: tokens.web_session
    )

    Subscriptions::DeviceManagement.stub(:new, operation) do
      get subscription_devices_path
    end

    assert_response :success
    assert_includes response.body, "iPhone"
    assert_select "form[action=?]",
      subscription_device_path("device-1"),
      count: 1
    assert_select "form[action=?]", subscription_devices_path, count: 1
    operation.verify
  end
end
