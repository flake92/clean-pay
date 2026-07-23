require "test_helper"

class Http011Test < ActionDispatch::IntegrationTest
  test "verifies registration payload and normalizes the optional name" do
    user = create_web_user
    sign_in_as(user)
    ceremony = Object.new
    received = nil
    ceremony.define_singleton_method(:register!) do |**arguments|
      received = arguments
    end

    Identity::PasskeyCeremony.stub(:new, ceremony) do
      patch "/account/passkey_registration",
        params: {
          id: "credential",
          name: "  Рабочий   ключ  ",
          response: { clientDataJSON: "encoded" }
        }.to_json,
        headers: json_headers
    end

    assert_response :ok
    assert_equal user, received.fetch(:web_user)
    assert_equal "  Рабочий   ключ  ", received.fetch(:name)
    assert_not received.fetch(:payload).key?("name")
  end
end
