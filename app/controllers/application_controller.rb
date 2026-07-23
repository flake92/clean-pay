class ApplicationController < ActionController::Base
  include Pundit::Authorization
  include ErrorHandling
  include SessionAuthentication

  protect_from_forgery with: :exception

  around_action :with_current_context

  # Changes to the importmap will invalidate the etag for HTML responses
  stale_when_importmap_changes

  private

  def with_current_context
    Current.set(
      request_id: request.request_id,
      user_agent: request.user_agent,
      ip_hash: hashed_ip
    ) { yield }
  end

  def pundit_user = Current.web_user

  def hashed_ip
    secret = Rails.application.config.x.clean_pay.security.audit_ip_hash_secret
    return unless secret && request.remote_ip

    OpenSSL::HMAC.hexdigest("SHA256", secret.value, request.remote_ip)
  end

  def verify_turnstile!(body)
    Integrations::TurnstileClient.new.verify!(
      token: body[:turnstile_token] || body["turnstileToken"] ||
        body[:"cf-turnstile-response"],
      remote_ip: request.remote_ip
    )
  end
end
