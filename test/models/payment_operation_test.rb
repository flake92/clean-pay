require "test_helper"

class PaymentOperationTest < ActiveSupport::TestCase
  test "persists explicit payment state transitions" do
    operation = create_operation

    operation.dispatch!
    assert_predicate operation.reload, :dispatching?

    operation.lose_outcome!
    assert_predicate operation.reload, :outcome_unknown?

    operation.succeed!
    assert_predicate operation.reload, :succeeded?
  end

  test "binds one idempotency digest to a user" do
    operation = create_operation
    duplicate = build_operation(
      web_user: operation.web_user,
      idempotency_key_hash: operation.idempotency_key_hash
    )

    assert_not duplicate.valid?
    assert duplicate.errors.of_kind?(:idempotency_key_hash, :taken)
  end

  private

  def create_operation(**attributes)
    build_operation(**attributes).tap(&:save!)
  end

  def build_operation(**attributes)
    PaymentOperation.new(
      {
        web_user: create_web_user,
        kind: :purchase,
        idempotency_key_hash: SecureRandom.hex(32),
        request_fingerprint: SecureRandom.hex(32),
        request_payload: { "offer_id" => "offer-1" },
        upstream_key: SecureRandom.uuid
      }.merge(attributes)
    )
  end
end
