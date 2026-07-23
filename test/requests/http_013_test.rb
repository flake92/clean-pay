require "test_helper"

class Http013Test < ActionDispatch::IntegrationTest
  test "uses a verified assertion as authorization and creates a session" do
    user = create_web_user
    ceremony = Object.new
    ceremony.define_singleton_method(:authenticate!) do |payload:|
      raise unless payload.dig("response", "clientDataJSON") == "encoded"

      user
    end

    Identity::PasskeyCeremony.stub(:new, ceremony) do
      patch "/account/passkey_session",
        params: {
          id: "credential",
          response: { clientDataJSON: "encoded" }
        }.to_json,
        headers: json_headers
    end

    assert_response :ok
    assert_equal true, parsed_response.dig("data", "success")
    assert_equal "passkey", user.web_sessions.last.auth_method
    set_cookie = response.headers["Set-Cookie"].join("\n")
    assert_includes set_cookie, "clean_pay_access="
    assert_includes set_cookie, "clean_pay_refresh="
  end
end
