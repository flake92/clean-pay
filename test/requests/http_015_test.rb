require "test_helper"

class Http015Test < ActionDispatch::IntegrationTest
  test "deletes an owned credential but preserves the last one" do
    user = create_web_user
    sign_in_as(user)
    first = user.web_authn_credentials.create!(
      credential_id: "first",
      public_key: SecureRandom.random_bytes(64)
    )
    last = user.web_authn_credentials.create!(
      credential_id: "last",
      public_key: SecureRandom.random_bytes(64)
    )

    delete "/account/passkeys/#{first.id}"

    assert_redirected_to link_account_path
    assert_not WebAuthnCredential.exists?(first.id)

    delete "/account/passkeys/#{last.id}"

    assert_redirected_to root_path
    assert_equal "Действие недоступно.", flash[:alert]
    assert WebAuthnCredential.exists?(last.id)
  end
end
