require "test_helper"

class PaymentHistorySyncStateTest < ActiveSupport::TestCase
  test "requires a complete lease pair and nonnegative fence counters" do
    state = PaymentHistorySyncState.new(
      web_user: create_web_user,
      upstream_owner_hash: SecureRandom.hex(32),
      claim_token: "claim"
    )

    assert_not state.valid?
    assert state.errors.of_kind?(:claim_token, :invalid)

    state.lease_expires_at = 1.minute.from_now
    assert_predicate state, :valid?
    assert_predicate state, :lease_active?
  end
end
