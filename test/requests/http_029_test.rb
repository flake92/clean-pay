require "test_helper"

class Http029Test < ActionDispatch::IntegrationTest
  test "deletes all devices and redirects to collection" do
    tokens = sign_in_with_upstream
    operation = Minitest::Mock.new
    operation.expect(
      :delete_all,
      { "success" => true },
      [],
      web_session: tokens.web_session
    )

    Subscriptions::DeviceManagement.stub(:new, operation) do
      delete subscription_devices_path
    end

    assert_redirected_to subscription_devices_path
    operation.verify
  end
end
