class PwaController < ApplicationController
  skip_forgery_protection only: :service_worker

  def service_worker
    build_id = Rails.application.config.x.clean_pay.runtime.build_id
    return render(
      plain: "Service worker build ID is unavailable",
      status: :service_unavailable
    ) if build_id.blank?

    @build_id = build_id
    response.set_header("Cache-Control", "no-store")
    response.set_header("Service-Worker-Allowed", "/")
    render formats: :js
  end

  def manifest
    response.set_header("Cache-Control", "public, max-age=300")
  end
end
