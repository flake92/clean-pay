require "test_helper"

class Identity::SessionAuthenticatorTest < ActiveSupport::TestCase
  test "issues and authenticates access and refresh tokens" do
    result = authenticator.issue!(web_user: create_web_user, auth_method: :email)

    assert_equal result.web_session,
      authenticator.authenticate_access(result.access_token)

    rotated = authenticator.rotate!(result.refresh_token)

    refute_equal result.refresh_token, rotated.refresh_token
    assert_equal result.web_session, rotated.web_session
    assert_equal 1, result.web_session.web_refresh_tokens.count
  end

  test "returns the same successor during the grace window" do
    original = authenticator.issue!(
      web_user: create_web_user,
      auth_method: :telegram
    )
    first = authenticator.rotate!(original.refresh_token)
    replay = authenticator.rotate!(original.refresh_token)

    assert_equal first.refresh_token, replay.refresh_token
    assert_equal first.web_session.refresh_token_hash,
      replay.web_session.refresh_token_hash
  end

  test "revokes the session when a predecessor is replayed after grace" do
    original = authenticator.issue!(
      web_user: create_web_user,
      auth_method: :passkey
    )
    authenticator.rotate!(original.refresh_token, at: 1.minute.ago)

    assert_raises(Identity::SessionAuthenticator::CompromisedTokenError) do
      authenticator.rotate!(original.refresh_token)
    end
    assert_predicate original.web_session.reload.revoked_at, :present?
  end

  test "rejects access after logout" do
    result = authenticator.issue!(web_user: create_web_user, auth_method: :email)
    result.web_session.revoke!

    assert_raises(Identity::SessionAuthenticator::InvalidTokenError) do
      authenticator.authenticate_access(result.access_token)
    end
  end

  private

  def authenticator
    @authenticator ||= Identity::SessionAuthenticator.new
  end
end
