require "test_helper"

class Http008Test < ActionDispatch::IntegrationTest
  test "confirms an exact six-digit e-mail code" do
    user = create_web_user(email_verified: false)
    tokens = sign_in_as(user)
    result = {
      "success" => true,
      "email" => user.email,
      "already_verified" => false,
      "account_sync_pending" => false
    }
    operation = Object.new
    operation.define_singleton_method(:confirm!) do |web_session:, code:|
      raise unless web_session == tokens.web_session && code == "123456"

      result
    end

    Identity::EmailVerification.stub(:new, operation) do
      patch "/account/email_verification",
        params: {
          email_verification: {
            code: "123456",
            registration_flow: "true"
          }
        }
    end

    assert_redirected_to passkey_setup_path
  end

  test "rejects a code that is not six ASCII digits" do
    sign_in_as(create_web_user(email_verified: false))

    patch "/account/email_verification",
      params: { email_verification: { code: "１２３４５６" } }

    assert_redirected_to root_path
    assert_equal "Проверьте введённые данные.", flash[:alert]
  end
end
