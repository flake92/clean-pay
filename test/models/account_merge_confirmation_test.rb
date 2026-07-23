require "test_helper"

class AccountMergeConfirmationTest < ActiveSupport::TestCase
  test "claims and completes through a fenced lease" do
    confirmation = create_confirmation

    confirmation.claim!(token: "claim-1", lease_for: 1.minute)

    assert_predicate confirmation.reload, :processing?
    assert_predicate confirmation, :lease_active?
    assert_equal 1, confirmation.attempt_count

    confirmation.finish!

    assert_predicate confirmation.reload, :completed?
    assert_nil confirmation.claim_token
    assert_predicate confirmation.completed_at, :present?
  end

  test "does not claim an expired confirmation" do
    confirmation = create_confirmation(expires_at: 1.second.ago)

    assert_raises(AccountMergeConfirmation::ClaimUnavailableError) do
      confirmation.claim!(token: "claim-1", lease_for: 1.minute)
    end
    assert_predicate confirmation.reload, :pending?
  end

  private

  def create_confirmation(**attributes)
    create_web_user.account_merge_confirmations.create!(
      {
        token_hash: SecureRandom.hex(32),
        source_remnashop_user_id: "source",
        target_remnashop_user_id: "target",
        target_email: "target@example.test",
        telegram_id: "42",
        expires_at: 10.minutes.from_now
      }.merge(attributes)
    )
  end
end
