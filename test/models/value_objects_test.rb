require "test_helper"

class ValueObjectsTest < ActiveSupport::TestCase
  test "canonicalizes valid e-mail and rejects malformed input" do
    assert_equal "person@example.com",
      Identity::EmailAddress.parse(" PERSON@Example.COM ").to_s
    assert_raises(ActiveModel::ValidationError) {
      Identity::EmailAddress.parse("not-mail")
    }
  end

  test "accepts only a single-root relative return path" do
    assert_equal "/cabinet?tab=profile",
      Identity::SafeReturnPath.parse("/cabinet?tab=profile").to_s

    %w[//evil.example https://evil.example /back\\slash].each do |value|
      assert_raises(ActiveModel::ValidationError) {
        Identity::SafeReturnPath.parse(value)
      }
    end
  end

  test "validates and hashes UUID idempotency keys" do
    value = "550e8400-e29b-41d4-a716-446655440000"
    key = Payments::IdempotencyKey.parse(value)

    assert_equal 64, key.digest(secret: "secret").length
    assert_raises(ActiveModel::ValidationError) {
      Payments::IdempotencyKey.parse("not-uuid")
    }
  end

  test "accepts database-fit money without rounding" do
    assert_equal "123.45", Payments::MoneyAmount.parse("123.45").to_s

    assert_raises(ActiveModel::ValidationError) {
      Payments::MoneyAmount.parse("1.001")
    }
    assert_raises(ActiveModel::ValidationError) {
      Payments::MoneyAmount.parse("-1")
    }
    assert_raises(ActiveModel::ValidationError) {
      Payments::MoneyAmount.parse("10000000000.00")
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
    first = Payments::ConfirmedOffer.from(attributes)
    second = Payments::ConfirmedOffer.from(attributes.reverse_each.to_h)

    assert_equal first.fingerprint, second.fingerprint
    assert_raises(ActiveModel::ValidationError) do
      Payments::ConfirmedOffer.from(attributes.merge(amount: "1.123456789"))
    end
  end

  test "captures an explicit platform operation context" do
    user = create_web_user
    session = create_web_session(web_user: user)

    Current.set(
      web_user: user,
      web_session: session,
      request_id: "request-1",
      ip_hash: "ip-hash",
      user_agent: "test-agent"
    ) do
      context = Platform::OperationContext.current

      assert_equal "request-1", context.request_id
      assert_equal user.id, context.web_user_id
      assert_equal session.id, context.web_session_id
      assert_equal(
        {
          web_user_id: user.id,
          ip_hash: "ip-hash",
          metadata: {
            "request_id" => "request-1",
            "web_session_id" => session.id
          }
        },
        context.audit_attributes
      )
    end
  end
end
