require "test_helper"

class Http002Test < ActionDispatch::IntegrationTest
  test "creates a full Rails session without storing a password" do
    result = stubbed_authentication_result
    operation = Object.new
    operation.define_singleton_method(:login!) { |_payload| result }

    Identity::EmailAuthentication.stub(:new, operation) do
      post "/account/session",
        params: {
          session: {
            email: result.web_user.email,
            password: "transient-secret",
            turnstile_token: "token"
          }
        }
    end

    assert_redirected_to cabinet_path
    set_cookie = response.headers["Set-Cookie"].join("\n")
    assert_includes set_cookie, "clean_pay_access="
    assert_includes set_cookie, "clean_pay_refresh="
    assert_not WebUser.column_names.any? { _1.include?("password") }
  end
end
