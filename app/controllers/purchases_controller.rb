class PurchasesController < ApplicationController
  before_action :require_verified_identity!

  def create
    values = params.expect(
      purchase: %i[
        plan_code
        duration_days
        gateway_type
        confirmed_amount
        confirmed_currency
        offer_version
        submission_token
      ]
    )
    result = Payments::CreateOperation.new.call!(
      kind: :purchase,
      web_session: Current.web_session,
      params: values.except(:submission_token),
      submission_token: values.fetch(:submission_token)
    )
    expose_operation(result)
  end

  private

  def expose_operation(result)
    response.set_header("Cache-Control", "no-store")
    response.set_header("Idempotency-Replayed", result.replayed.to_s)
    response.set_header("X-Payment-Operation-Id", result.operation.id)
    redirect_to payment_path(result.operation),
      status: :see_other
  end
end
