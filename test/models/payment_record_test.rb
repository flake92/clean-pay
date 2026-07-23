require "test_helper"

class PaymentRecordTest < ActiveSupport::TestCase
  test "stores an exact nonnegative payment snapshot" do
    record = PaymentRecord.create!(
      web_user: create_web_user,
      payment_id: "pay-#{SecureRandom.hex(8)}",
      purchase_type: :new_purchase,
      status: :completed,
      final_amount: "123.45",
      currency: "RUB",
      gateway_type: "card"
    )

    assert_equal BigDecimal("123.45"), record.final_amount
    assert_predicate record, :completed?
  end

  test "rejects negative amounts" do
    record = PaymentRecord.new(
      web_user: create_web_user,
      payment_id: "pay-negative",
      purchase_type: :renew,
      final_amount: "-0.01",
      currency: "RUB",
      gateway_type: "card"
    )

    assert_not record.valid?
    assert record.errors.of_kind?(:final_amount, :greater_than_or_equal_to)
  end
end
