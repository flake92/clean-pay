require "test_helper"
require "webauthn/fake_client"

class Identity::PasskeyCeremonyTest < ActiveSupport::TestCase
  test "registers and authenticates a verified passkey exactly once" do
    user = create_web_user
    authenticator = WebAuthn::FakeAuthenticator.new
    client = WebAuthn::FakeClient.new(
      Rails.application.config.x.clean_pay.urls.app.origin,
      authenticator:
    )
    creation_options = ceremony.registration_options(web_user: user)
    creation = client.create(
      challenge: creation_options.challenge,
      user_verified: true
    )

    stored = ceremony.register!(
      web_user: user,
      payload: creation,
      name: "  Mac   Touch ID  "
    )

    assert_equal "Mac Touch ID", stored.name
    assert_equal user, stored.web_user

    request_options = ceremony.authentication_options
    assertion = client.get(
      challenge: request_options.challenge,
      user_verified: true,
      allow_credentials: [ stored.credential_id ]
    )

    assert_equal user, ceremony.authenticate!(payload: assertion)
    assert_predicate stored.reload.last_used_at, :present?
    assert_raises(Identity::PasskeyCeremony::InvalidCeremonyError) do
      ceremony.authenticate!(payload: assertion)
    end
  end

  test "rejects a credential response from another origin" do
    user = create_web_user
    options = ceremony.registration_options(web_user: user)
    response = WebAuthn::FakeClient.new("https://attacker.example").create(
      challenge: options.challenge,
      user_verified: true
    )

    assert_raises(Identity::PasskeyCeremony::InvalidCeremonyError) do
      ceremony.register!(web_user: user, payload: response)
    end
    assert_empty user.web_authn_credentials
  end

  private

  def ceremony
    @ceremony ||= Identity::PasskeyCeremony.new
  end
end
