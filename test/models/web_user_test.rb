require "test_helper"

class WebUserTest < ActiveSupport::TestCase
  test "normalizes identity values and reports verified identity" do
    user = WebUser.create!(
      email: "  PERSON@Example.COM ",
      telegram_id: " 123456 ",
      remnashop_user_id: " owner-1 "
    )

    assert_equal "person@example.com", user.email
    assert_equal "123456", user.telegram_id
    assert_equal "owner-1", user.remnashop_user_id
    assert_predicate user, :identity_verified?
  end

  test "enforces unique external identities" do
    create_web_user(email: "person@example.com", telegram_id: "42")
    duplicate = WebUser.new(email: " PERSON@example.com ", telegram_id: "42")

    assert_not duplicate.valid?
    assert duplicate.errors.of_kind?(:email, :taken)
    assert duplicate.errors.of_kind?(:telegram_id, :taken)
  end

  test "prevents deletion while durable payment operations exist" do
    user = create_web_user
    user.payment_operations.create!(
      kind: "PURCHASE",
      idempotency_key_hash: SecureRandom.hex(32),
      request_fingerprint: SecureRandom.hex(32),
      request_payload: { "offer_id" => "offer-1" },
      upstream_key: SecureRandom.uuid
    )

    assert_not user.destroy
    assert_predicate user.reload, :persisted?
    assert_equal 1, user.payment_operations.count
  end
end
