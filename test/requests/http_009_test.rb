require "test_helper"

class Http009Test < ActionDispatch::IntegrationTest
  test "starts e-mail change only for a full session" do
    user = create_web_user
    tokens = sign_in_as(user)
    result = {
      "success" => true,
      "pending_email" => "new@example.test",
      "emailVerification" => {
        "success" => true,
        "target_email" => "new@example.test",
        "expires_at" => 15.minutes.from_now.iso8601
      }
    }
    operation = Object.new
    operation.define_singleton_method(:change!) do |web_session:, email:|
      raise unless web_session == tokens.web_session
      raise unless email == "new@example.test"

      result
    end

    Identity::EmailVerification.stub(:new, operation) do
      patch "/account/email",
        params: { email: { value: "new@example.test" } }
    end

    assert_redirected_to verify_email_path
  end
end
