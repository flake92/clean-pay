require "test_helper"

class Http007Test < ActionDispatch::IntegrationTest
  test "requests an e-mail verification for an unverified session" do
    user = create_web_user(email_verified: false)
    tokens = sign_in_as(user)
    result = {
      "success" => true,
      "target_email" => user.email,
      "expires_at" => 15.minutes.from_now.iso8601
    }
    operation = Object.new
    operation.define_singleton_method(:request!) do |web_session:, email:|
      raise unless web_session == tokens.web_session
      raise unless email == user.email

      result
    end

    Identity::EmailVerification.stub(:new, operation) do
      post "/account/email_verification",
        params: {
          email_verification: {
            email: user.email,
            turnstile_token: "token"
          }
        }
    end

    assert_redirected_to verify_email_path
  end
end
