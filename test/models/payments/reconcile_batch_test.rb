require "test_helper"

class Payments::ReconcileBatchTest < ActiveSupport::TestCase
  class FakeClient
    attr_accessor :response, :error

    def payment_recovery(**)
      raise error if error

      response
    end
  end

  setup do
    @user = create_web_user(remnashop_user_id: "upstream-77")
    create_web_session(
      web_user: @user,
      assurance_level: :full,
      auth_method: :email,
      remnashop_access_token: "upstream-access",
      remnashop_refresh_token: "upstream-refresh"
    )
    @operation = @user.payment_operations.create!(
      kind: :purchase,
      idempotency_key_hash: SecureRandom.hex(32),
      request_fingerprint: SecureRandom.hex(32),
      request_payload: { "plan_code" => "basic" },
      upstream_key: SecureRandom.uuid
    )
    @operation.claim_dispatch!(lease_for: 1.second, at: 2.seconds.ago)
    @client = FakeClient.new
  end

  test "settles a successful recovery exactly under its claim" do
    @client.response = {
      "operation" => "PURCHASE",
      "state" => "SUCCEEDED",
      "retry_after_seconds" => nil,
      "payment" => {
        "payment_id" => "65f5241d-3cc9-4de4-86a1-bb549af7c93b",
        "payment_url" => "https://pay.example.test/session",
        "purchase_type" => "NEW",
        "status" => "PENDING",
        "final_amount" => "199.00",
        "currency" => "RUB",
        "is_free" => false
      },
      "transaction" => transaction
    }

    result = Payments::ReconcileBatch.new(client: @client).call!(
      limit: 1
    )

    assert_equal 1, result.claimed
    assert_equal 1, result.succeeded
    assert_predicate @operation.reload, :succeeded?
    assert_predicate @operation.reconciled_at, :present?
    assert_equal 1, @user.payment_records.count
  end

  test "defers an unknown result without redispatching" do
    @client.response = {
      "operation" => "PURCHASE",
      "state" => "UNKNOWN",
      "payment" => nil,
      "transaction" => nil,
      "retry_after_seconds" => 9
    }

    result = Payments::ReconcileBatch.new(client: @client).call!(
      limit: 1
    )

    assert_equal 1, result.deferred
    assert_predicate @operation.reload, :dispatching?
    assert_in_delta 9.seconds.from_now, @operation.reconciliation_next_at,
      2.seconds
  end

  test "moves an unprovable operation to manual review" do
    @client.response = {
      "operation" => "PURCHASE",
      "state" => "MANUAL_REQUIRED",
      "payment" => nil,
      "transaction" => nil,
      "retry_after_seconds" => nil
    }

    result = Payments::ReconcileBatch.new(client: @client).call!(
      limit: 1
    )

    assert_equal 1, result.manual_required
    assert_predicate @operation.reload, :manual_required?
  end

  private

  def transaction
    {
      "payment_id" => "65f5241d-3cc9-4de4-86a1-bb549af7c93b",
      "purchase_type" => "NEW",
      "status" => "PENDING",
      "gateway_type" => "CARD",
      "final_amount" => "199.00",
      "currency" => "RUB",
      "plan_name" => "Базовый",
      "duration_days" => 30,
      "device_limit" => 2,
      "traffic_limit" => 1000,
      "created_at" => 1.minute.ago.iso8601,
      "updated_at" => Time.current.iso8601
    }
  end
end
