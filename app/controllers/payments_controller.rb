class PaymentsController < ApplicationController
  before_action :require_verified_identity!

  def index
    @payments = Payments::SyncHistoryPage.new.call!(
      web_session: Current.web_session
    )
    response.set_header("Cache-Control", "no-store")
  end

  def show
    @operation = Current.web_user.payment_operations
      .includes(:payment_record)
      .find(params[:id])
    @payment = @operation.payment_record
    response.set_header("Cache-Control", "no-store")
  end
end
