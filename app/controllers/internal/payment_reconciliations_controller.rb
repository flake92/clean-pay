module Internal
  class PaymentReconciliationsController < ApplicationController
    skip_forgery_protection only: :create

    def create
      return head :not_found unless internal_request_authenticated?

      config = Rails.application.config.x.clean_pay.reconciliation
      @result = Payments::ReconcileBatch.new.call!(
        limit: config.batch_size,
        deadline: 12.seconds.from_now
      )
      @history = Payments::SyncHistoryBatch.new.call!(
        limit: 1,
        deadline: 12.seconds.from_now
      )
      response.set_header("Cache-Control", "no-store")
      render :show, formats: :json
    end

    private

    def internal_request_authenticated?
      config = Rails.application.config.x.clean_pay.reconciliation
      supplied = request.headers["X-Clean-Pay-Reconciliation-Secret"].to_s
      expected = config.secret&.value.to_s
      allowed = config.enabled && supplied.present? && expected.present? &&
        ActiveSupport::SecurityUtils.secure_compare(
          Digest::SHA256.hexdigest(supplied),
          Digest::SHA256.hexdigest(expected)
        )
      allowed
    end
  end
end
