require "test_helper"

class Http003Test < ActionDispatch::IntegrationTest
  test "registers through the upstream boundary and returns 201" do
    result = stubbed_authentication_result(
      web_user: create_web_user(email_verified: false)
    )
    operation = Object.new
    operation.define_singleton_method(:register!) { |_payload| result }
    verification = Object.new
    requested = nil
    verification.define_singleton_method(:request!) do |**arguments|
      requested = arguments
      { "target_email" => result.web_user.email }
    end

    Identity::EmailAuthentication.stub(:new, operation) do
      Identity::EmailVerification.stub(:new, verification) do
        post "/account/registration",
          params: {
            registration: {
              email: result.web_user.email,
              password: "transient-secret"
            }
          }
      end
    end

    assert_redirected_to register_verify_email_path
    assert_includes response.headers["Set-Cookie"].join("\n"), "httponly"
    assert_equal result.tokens.web_session, requested.fetch(:web_session)
    assert_equal result.web_user.email, requested.fetch(:email)
  end
end
