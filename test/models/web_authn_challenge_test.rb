require "test_helper"

class WebAuthnChallengeTest < ActiveSupport::TestCase
  test "consumes an available challenge exactly once" do
    challenge = WebAuthnChallenge.create!(
      web_user: create_web_user,
      challenge: SecureRandom.urlsafe_base64(32),
      challenge_type: :registration,
      expires_at: 5.minutes.from_now
    )

    challenge.consume!

    assert_predicate challenge.reload.consumed_at, :present?
    assert_raises(WebAuthnChallenge::UnavailableError) { challenge.consume! }
  end

  test "rejects an expired challenge" do
    challenge = WebAuthnChallenge.create!(
      challenge: SecureRandom.urlsafe_base64(32),
      challenge_type: :authentication,
      expires_at: 1.second.ago
    )

    assert_raises(WebAuthnChallenge::UnavailableError) { challenge.consume! }
    assert_nil challenge.reload.consumed_at
  end
end
