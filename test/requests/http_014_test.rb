require "test_helper"

class Http014Test < ActionDispatch::IntegrationTest
  test "server-renders only the safe credential projection" do
    user = create_web_user
    sign_in_as(user)
    credential = user.web_authn_credentials.create!(
      credential_id: "wire-credential",
      public_key: SecureRandom.random_bytes(64),
      name: "Телефон",
      transports: %w[internal],
      counter: 12
    )

    get "/account/passkeys"

    assert_response :ok
    assert_includes response.body, "Телефон"
    assert_includes response.body, account_passkey_path(credential)
    assert_not_includes response.body,
      Base64.strict_encode64(credential.public_key)
    assert_not_includes response.body, "wire-credential"
  end
end
