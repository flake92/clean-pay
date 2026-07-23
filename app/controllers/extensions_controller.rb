class ExtensionsController < ApplicationController
  before_action :require_verified_identity!

  def create
    values = params.expect(
      extension: %i[
        duration_days
        gateway_type
        confirmed_amount
        confirmed_currency
        offer_version
        submission_token
      ]
    )
    result = Payments::CreateOperation.new.call!(
      kind: :extend,
      web_session: Current.web_session,
      params: values.except(:submission_token),
      submission_token: values.fetch(:submission_token)
    )
    response.set_header("Cache-Control", "no-store")
    response.set_header("Idempotency-Replayed", result.replayed.to_s)
    response.set_header("X-Payment-Operation-Id", result.operation.id)
    redirect_to payment_path(result.operation),
      status: :see_other
  end
end
