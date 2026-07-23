require "test_helper"

class Http030Test < ActionDispatch::IntegrationTest
  test "deletes one decoded device identifier and redirects" do
    tokens = sign_in_with_upstream
    operation = Minitest::Mock.new
    operation.expect(
      :delete,
      { "deleted" => true },
      [],
      web_session: tokens.web_session,
      hwid: "device 1"
    )

    Subscriptions::DeviceManagement.stub(:new, operation) do
      delete subscription_device_path("device 1")
    end

    assert_redirected_to subscription_devices_path
    operation.verify
  end
end
