class Account::TelegramAuthorizationsController < ApplicationController
  STATE_COOKIE = :clean_pay_tg_state
  NONCE_COOKIE = :clean_pay_tg_nonce
  VERIFIER_COOKIE = :clean_pay_tg_code_verifier

  def new
    verify_turnstile!(params.permit(:turnstile_token, :"cf-turnstile-response"))
    return_path = Identity::SafeReturnPath.parse(
      params[:redirect_to],
      default: cabinet_path
    )
    state, secrets = TelegramAuthState.issue!(
      web_user: Current.web_user,
      redirect_to: return_path.to_s
    )
    write_ceremony_cookies(secrets)
    url = oidc_client.authorization_url(
      state: secrets.state,
      nonce: secrets.nonce,
      verifier: secrets.verifier
    )
    redirect_to url, allow_other_host: true, status: :found
  rescue ActiveModel::ValidationError
    telegram_failure!
  end

  def callback
    state = find_and_consume_state!
    identity = telegram_identity
    result = Identity::TelegramAuthentication.new.oidc!(identity)
    write_session_cookies(result.tokens)
    clear_ceremony_cookies
    redirect_to state.redirect_to.presence || cabinet_path, status: :see_other
  rescue TelegramAuthState::UnavailableError,
    Integrations::TelegramOidcClient::Error,
    Integrations::TelegramPayload::InvalidError,
    Identity::TelegramAuthentication::OwnershipConflictError
    telegram_failure!
  end

  private

  def oidc_client
    @oidc_client ||= Integrations::TelegramOidcClient.new
  end

  def telegram_identity
    return widget_identity if request.post?

    code = params.expect(:code)
    token = oidc_client.exchange(
      code:,
      verifier: cookies[VERIFIER_COOKIE].to_s
    )
    oidc_client.verify(token, nonce: cookies[NONCE_COOKIE].to_s)
  end

  def widget_identity
    body = params.permit(
      :id,
      :first_name,
      :last_name,
      :username,
      :photo_url,
      :auth_date,
      :hash
    ).to_h
    bot_token = Rails.application.config.x.clean_pay.telegram.bot_token&.value
    raise Integrations::TelegramPayload::InvalidError if bot_token.blank?

    Integrations::TelegramPayload.verify(body, bot_token:)
  end

  def find_and_consume_state!
    raw_state = params[:state].presence || cookies[STATE_COOKIE].to_s
    record = TelegramAuthState.find_by!(
      state_hash: TelegramAuthState.digest(raw_state)
    )
    record.consume!(
      state: raw_state,
      nonce: cookies[NONCE_COOKIE].to_s,
      verifier: cookies[VERIFIER_COOKIE].to_s
    )
    record
  end

  def write_ceremony_cookies(secrets)
    options = session_cookie_options.merge(expires: 10.minutes.from_now)
    cookies[STATE_COOKIE] = options.merge(value: secrets.state)
    cookies[NONCE_COOKIE] = options.merge(value: secrets.nonce)
    cookies[VERIFIER_COOKIE] = options.merge(value: secrets.verifier)
  end

  def clear_ceremony_cookies
    options = session_cookie_options.except(:httponly)
    cookies.delete(STATE_COOKIE, **options)
    cookies.delete(NONCE_COOKIE, **options)
    cookies.delete(VERIFIER_COOKIE, **options)
  end

  def telegram_failure!
    clear_ceremony_cookies
    destination = Current.web_user ? link_account_path : login_path
    redirect_to(
      destination,
      alert: "Не удалось подтвердить вход через Telegram.",
      status: :see_other
    )
  end
end
