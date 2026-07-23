require "test_helper"

class Http025Test < ActionDispatch::IntegrationTest
  test "submits an extension without accepting a browser plan code" do
    tokens = sign_in_with_upstream(
      create_web_user(remnashop_user_id: "extension-owner")
    )
    operation = tokens.web_session.web_user.payment_operations.create!(
      kind: :extend,
      idempotency_key_hash: SecureRandom.hex(32),
      request_fingerprint: SecureRandom.hex(32),
      request_payload: { "duration_days" => 30 },
      upstream_key: SecureRandom.uuid
    )
    service = Object.new
    captured = nil
    service.define_singleton_method(:call!) do |**attributes|
      captured = attributes
      Payments::CreateOperation::Result.new(
        operation:,
        payment: nil,
        replayed: true
      )
    end

    Payments::CreateOperation.stub(:new, service) do
      post extensions_path, params: {
        extension: {
          plan_code: "must-be-dropped",
          duration_days: "30",
          gateway_type: "CARD",
          confirmed_amount: "199.00",
          confirmed_currency: "RUB",
          offer_version: "version",
          submission_token: "signed"
        }
      }
    end

    assert_response :see_other
    assert_redirected_to payment_path(operation)
    assert_equal "true", response.headers["Idempotency-Replayed"]
    assert_not captured.fetch(:params).key?(:plan_code)
    assert_equal :extend, captured.fetch(:kind)
  end
end
