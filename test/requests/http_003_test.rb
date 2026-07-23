require "test_helper"

class Http003Test < ActionDispatch::IntegrationTest
  test "registers through the upstream boundary and returns 201" do
    result = stubbed_authentication_result(
      web_user: create_web_user(email_verified: false)
    )
    operation = Object.new
    operation.define_singleton_method(:register!) { |_payload| result }

    Identity::EmailAuthentication.stub(:new, operation) do
      post "/account/registration",
        params: {
          registration: {
            email: result.web_user.email,
            password: "transient-secret"
          }
        }
    end

    assert_redirected_to register_verify_email_path
    assert_includes response.headers["Set-Cookie"].join("\n"), "httponly"
  end
end
