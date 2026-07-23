require "test_helper"

class TelegramAuthStateTest < ActiveSupport::TestCase
  test "issues digests and consumes the matching ceremony once" do
    state, secrets = TelegramAuthState.issue!(
      web_user: create_web_user,
      redirect_to: "/cabinet"
    )

    refute_equal secrets.state, state.state_hash
    refute_equal secrets.nonce, state.nonce_hash
    refute_equal secrets.verifier, state.verifier_hash

    state.consume!(
      state: secrets.state,
      nonce: secrets.nonce,
      verifier: secrets.verifier
    )

    assert_predicate state.reload.consumed_at, :present?
    assert_raises(TelegramAuthState::UnavailableError) do
      state.consume!(
        state: secrets.state,
        nonce: secrets.nonce,
        verifier: secrets.verifier
      )
    end
  end

  test "rejects unsafe return paths" do
    state, = TelegramAuthState.issue!
    state.redirect_to = "//attacker.example"

    assert_not state.valid?
    assert state.errors.of_kind?(:redirect_to, :invalid)
  end
end
