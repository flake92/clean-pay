require "test_helper"

class ValueObjectsTest < ActiveSupport::TestCase
  test "canonicalizes valid e-mail and rejects malformed input" do
    assert_equal "person@example.com", EmailAddress.parse(" PERSON@Example.COM ").to_s
    assert_raises(ActiveModel::ValidationError) { EmailAddress.parse("not-mail") }
  end

  test "accepts only a single-root relative return path" do
    assert_equal "/cabinet?tab=profile", SafeReturnPath.parse("/cabinet?tab=profile").to_s

    %w[//evil.example https://evil.example /back\\slash].each do |value|
      assert_raises(ActiveModel::ValidationError) { SafeReturnPath.parse(value) }
    end
  end

  test "validates and hashes UUID idempotency keys" do
    value = "550e8400-e29b-41d4-a716-446655440000"
    key = IdempotencyKey.parse(value)

    assert_equal 64, key.digest(secret: "secret").length
    assert_raises(ActiveModel::ValidationError) { IdempotencyKey.parse("not-uuid") }
  end

  test "accepts database-fit money without rounding" do
    assert_equal "123.45", MoneyAmount.parse("123.45").to_s

    assert_raises(ActiveModel::ValidationError) { MoneyAmount.parse("1.001") }
    assert_raises(ActiveModel::ValidationError) { MoneyAmount.parse("-1") }
    assert_raises(ActiveModel::ValidationError) {
      MoneyAmount.parse("10000000000.00")
    }
  end

  test "creates a stable confirmed-offer fingerprint" do
    attributes = {
      amount: "10.12345678",
      currency: "USDT",
      version: "offer-v1",
      duration_days: "30",
      plan_id: "basic"
    }
    first = ConfirmedOffer.from(attributes)
    second = ConfirmedOffer.from(attributes.reverse_each.to_h)

    assert_equal first.fingerprint, second.fingerprint
    assert_raises(ActiveModel::ValidationError) do
      ConfirmedOffer.from(attributes.merge(amount: "1.123456789"))
    end
  end
end
