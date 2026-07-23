class HealthsController < ApplicationController
  skip_forgery_protection

  def show
    render_liveness
  end

  def liveness
    render_liveness
  end

  def readiness
    @payload = Platform::ReadinessCheck.public_snapshot
    response.set_header("Cache-Control", "no-store")
    render :show,
      formats: :json,
      status: @payload.fetch("status") == "ok" ? :ok : :service_unavailable
  end

  private

  def render_liveness
    @payload = {
      "status" => "ok",
      "service" => "clean-pay",
      "version" =>
        Rails.application.config.x.clean_pay.runtime.build_id || "0.1.0"
    }
    render :show, formats: :json
  end
end
