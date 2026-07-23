require "test_helper"

class WebAuthnCredentialTest < ActiveSupport::TestCase
  test "updates the signature counter under a row lock" do
    credential = create_credential

    credential.record_authentication!(new_counter: 2)

    assert_equal 2, credential.reload.counter
    assert_predicate credential.last_used_at, :present?
    assert_raises(ActiveRecord::StaleObjectError) do
      credential.record_authentication!(new_counter: 1)
    end
  end

  test "does not delete the last credential" do
    first = create_credential

    assert_not first.destroy
    assert first.errors.of_kind?(:base, :last_credential)

    second = create_credential(web_user: first.web_user)
    assert first.destroy
    assert_predicate second.reload, :persisted?
  end

  private

  def create_credential(web_user: create_web_user)
    web_user.web_authn_credentials.create!(
      credential_id: SecureRandom.urlsafe_base64(32),
      public_key: SecureRandom.random_bytes(64),
      transports: %w[internal]
    )
  end
end
