require "test_helper"

class Http032Test < ActionDispatch::IntegrationTest
  test "renders only the current user's durable payment operation" do
    tokens = sign_in_with_upstream(
      create_web_user(remnashop_user_id: "status-owner")
    )
    operation = tokens.web_session.web_user.payment_operations.create!(
      kind: :purchase,
      idempotency_key_hash: SecureRandom.hex(32),
      request_fingerprint: SecureRandom.hex(32),
      request_payload: { "plan_code" => "basic" },
      upstream_key: SecureRandom.uuid,
      status: :manual_required
    )

    get payment_path(operation)

    assert_response :success
    assert_equal "text/html", response.media_type
    assert_select "h1", "Состояние платежа"
    assert_includes response.body, "manual_required"
    assert_includes response.body, "Повторно оплачивать не нужно"
    assert_equal "no-store", response.headers["Cache-Control"]
  end
end
