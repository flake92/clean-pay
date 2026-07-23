require "test_helper"

class Payments::SyncHistoryPageTest < ActiveSupport::TestCase
  class FakeClient
    attr_accessor :items, :next_cursor

    def capabilities(access_token:)
      raise "missing token" if access_token.blank?

      {
        "contract_version" => 1,
        "transactions" => {
          "keyset_pagination" => true,
          "max_page_size" => 50
        }
      }
    end

    def transaction_page(access_token:, limit:, cursor: nil)
      raise "missing token" if access_token.blank?
      raise "bad limit" unless limit == 50

      {
        "items" => items,
        "next_cursor" => next_cursor
      }
    end
  end

  setup do
    @user = create_web_user(remnashop_user_id: "upstream-99")
    @session = create_web_session(
      web_user: @user,
      assurance_level: :full,
      auth_method: :email,
      remnashop_access_token: "upstream-access",
      remnashop_refresh_token: "upstream-refresh"
    )
    @client = FakeClient.new
    @client.items = [ transaction ]
    @client.next_cursor = nil
  end

  test "atomically upserts one capability page and advances the fence" do
    records = Payments::SyncHistoryPage.new(client: @client).call!(
      web_session: @session
    )
    state = @user.payment_history_sync_state.reload

    assert_equal 1, records.size
    assert_equal 1, @user.payment_records.count
    assert_equal 1, state.generation
    assert_predicate state.backfill_completed_at, :present?
    assert_nil state.claim_token
  end

  test "rejects a state bound to another upstream owner" do
    PaymentHistorySyncState.create!(
      web_user: @user,
      upstream_owner_hash: SecureRandom.hex(32)
    )

    assert_raises(Payments::SyncHistoryPage::OwnershipConflictError) do
      Payments::SyncHistoryPage.new(client: @client).call!(
        web_session: @session
      )
    end
    assert_empty @user.payment_records
  end

  test "a stale lease holder cannot advance a reclaimed generation" do
    state = PaymentHistorySyncState.create!(
      web_user: @user,
      upstream_owner_hash: SecureRandom.hex(32)
    )
    stale = state.claim!(lease_for: 1.second, at: 2.seconds.ago)
    current = state.claim!(lease_for: 1.minute)

    assert_raises(PaymentHistorySyncState::StaleClaimError) do
      state.advance!(claim: stale, cursor: "stale", complete: false)
    end
    state.advance!(claim: current, cursor: "current", complete: false)
    assert_equal "current", state.reload.cursor
  end

  test "the bounded worker continues one incomplete history" do
    @client.next_cursor = "next-page"
    sync = Payments::SyncHistoryPage.new(client: @client)
    sync.call!(web_session: @session)
    assert_nil @user.payment_history_sync_state.backfill_completed_at

    @client.next_cursor = nil
    result = Payments::SyncHistoryBatch.new(sync:).call!(limit: 1)

    assert_equal 1, result.claimed
    assert_equal 1, result.succeeded
    assert_predicate(
      @user.payment_history_sync_state.reload.backfill_completed_at,
      :present?
    )
  end

  private

  def transaction
    {
      "payment_id" => "65f5241d-3cc9-4de4-86a1-bb549af7c93b",
      "purchase_type" => "NEW",
      "status" => "COMPLETED",
      "gateway_type" => "CARD",
      "final_amount" => "199.00",
      "currency" => "RUB",
      "plan_name" => "Базовый",
      "duration_days" => 30,
      "device_limit" => 2,
      "traffic_limit" => 1000,
      "created_at" => 2.minutes.ago.iso8601,
      "updated_at" => 1.minute.ago.iso8601
    }
  end
end
