module Internal
  class ReadinessController < ApplicationController
    def show
      return head :not_found unless authenticated?

      result = Platform::ReadinessCheck.new.call
      @payload = {
        status: result.status,
        checked_at: result.checked_at,
        checks: result.checks,
        service: "clean-pay",
        version:
          Rails.application.config.x.clean_pay.runtime.build_id || "0.1.0"
      }
      response.set_header("Cache-Control", "no-store")
      render :show,
        formats: :json,
        status: result.status == "ok" ? :ok : :service_unavailable
    rescue StandardError => error
      Rails.logger.error(
        event: "internal_readiness_failed",
        error_class: error.class.name
      )
      render json: {
        status: "degraded",
        service: "clean-pay",
        checked_at: nil
      }, status: :service_unavailable
    end

    private

    def authenticated?
      expected = Rails.application.config.x.clean_pay.readiness
        .internal_secret&.value.to_s
      supplied = request.headers["X-Clean-Pay-Readiness-Secret"].to_s
      expected.present? && supplied.present? &&
        ActiveSupport::SecurityUtils.secure_compare(
          Digest::SHA256.hexdigest(expected),
          Digest::SHA256.hexdigest(supplied)
        )
    end
  end
end
