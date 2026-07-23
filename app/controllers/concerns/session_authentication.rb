module SessionAuthentication
  extend ActiveSupport::Concern

  ACCESS_COOKIE = :clean_pay_access
  REFRESH_COOKIE = :clean_pay_refresh

  included do
    before_action :load_current_session
  end

  private

  def session_authenticator
    @session_authenticator ||= Identity::SessionAuthenticator.new
  end

  def load_current_session
    session = authenticate_access_cookie || rotate_refresh_cookie
    Current.web_session = session
    Current.web_user = session&.web_user
  rescue Identity::SessionAuthenticator::InvalidTokenError
    clear_session_cookies
  end

  def authenticate_access_cookie
    token = cookies[ACCESS_COOKIE]
    session_authenticator.authenticate_access(token) if token.present?
  rescue Identity::SessionAuthenticator::InvalidTokenError
    nil
  end

  def rotate_refresh_cookie
    token = cookies[REFRESH_COOKIE]
    return if token.blank?

    tokens = session_authenticator.rotate!(token)
    write_session_cookies(tokens)
    tokens.web_session
  end

  def require_session!
    raise ErrorHandling::Error.new("UNAUTHORIZED", status: :unauthorized) unless
      Current.web_session
  end

  def require_full_session!
    require_session!
    raise ErrorHandling::Error.new("FORBIDDEN", status: :forbidden) unless
      Current.web_session.full?
  end

  def require_verified_identity!
    require_full_session!
    raise ErrorHandling::Error.new(
      "EMAIL_NOT_VERIFIED",
      status: :forbidden
    ) unless Current.web_user.identity_verified?
  end

  def write_session_cookies(tokens)
    options = session_cookie_options
    write_access_cookie(tokens.access_token, tokens.web_session)
    cookies[REFRESH_COOKIE] = options.merge(
      value: tokens.refresh_token,
      expires: tokens.web_session.refresh_expires_at
    )
  end

  def write_access_cookie(access_token, web_session)
    cookies[ACCESS_COOKIE] = session_cookie_options.merge(
      value: access_token,
      expires: web_session.access_expires_at
    )
  end

  def clear_session_cookies
    options = session_cookie_options.except(:httponly)
    cookies.delete(ACCESS_COOKIE, **options)
    cookies.delete(REFRESH_COOKIE, **options)
  end

  def session_cookie_options
    config = Rails.application.config.x.clean_pay.cookies
    {
      httponly: true,
      secure: config.secure,
      same_site: config.same_site,
      path: "/"
    }
  end
end
