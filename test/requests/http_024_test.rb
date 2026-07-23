require "test_helper"

class Http024Test < ActionDispatch::IntegrationTest
  test "submits a Rails purchase form and redirects to the durable operation" do
    tokens = sign_in_with_upstream(
      create_web_user(remnashop_user_id: "purchase-owner")
    )
    operation = tokens.web_session.web_user.payment_operations.create!(
      kind: :purchase,
      idempotency_key_hash: SecureRandom.hex(32),
      request_fingerprint: SecureRandom.hex(32),
      request_payload: { "plan_code" => "basic" },
      upstream_key: SecureRandom.uuid
    )
    service = Minitest::Mock.new
    service.expect(
      :call!,
      Payments::CreateOperation::Result.new(
        operation:,
        payment: nil,
        replayed: false
      ),
      [],
      kind: :purchase,
      web_session: tokens.web_session,
      params: ActionController::Parameters.new(
        plan_code: "basic",
        duration_days: "30",
        gateway_type: "CARD",
        confirmed_amount: "199.00",
        confirmed_currency: "RUB",
        offer_version: "version"
      ).permit!,
      submission_token: "signed"
    )

    Payments::CreateOperation.stub(:new, service) do
      post purchases_path, params: {
        purchase: {
          plan_code: "basic",
          duration_days: "30",
          gateway_type: "CARD",
          confirmed_amount: "199.00",
          confirmed_currency: "RUB",
          offer_version: "version",
          submission_token: "signed",
          return_url: "https://attacker.example"
        }
      }
    end

    assert_response :see_other
    assert_redirected_to payment_path(operation)
    assert_equal "false", response.headers["Idempotency-Replayed"]
    assert_equal operation.id, response.headers["X-Payment-Operation-Id"]
    assert_equal "no-store", response.headers["Cache-Control"]
    service.verify
  end
end
