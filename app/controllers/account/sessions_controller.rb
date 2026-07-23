class Account::SessionsController < ApplicationController
  def create
    body = params.expect(
      session: [
        :email,
        :password,
        :turnstile_token,
        :"cf-turnstile-response"
      ]
    )
    verify_turnstile!(body)
    result = Identity::EmailAuthentication.new.login!(
      body.except(:turnstile_token, :"cf-turnstile-response").to_h
    )
    write_session_cookies(result.tokens)
    redirect_to destination_for(result.web_user), status: :see_other
  end

  def show
    require_session!
    redirect_to profile_path, status: :see_other
  end

  def destroy
    Current.web_user&.web_sessions&.active&.update_all(
      revoked_at: Time.current,
      updated_at: Time.current
    )
    clear_session_cookies
    redirect_to root_path, notice: "Вы вышли из аккаунта.", status: :see_other
  end

  def update
    require_session!
    raise ErrorHandling::Error.new("FORBIDDEN", status: :forbidden) unless
      Current.web_session.bootstrap? && Current.web_user.identity_verified?

    Current.web_session.update!(assurance_level: :full, auth_method: :email)
    access_token = session_authenticator.reissue_access!(Current.web_session)
    write_access_cookie(access_token, Current.web_session)
    redirect_to cabinet_path, status: :see_other
  end

  private

  def destination_for(user)
    return passkey_setup_path if user.auth_pending?
    return verify_email_path unless user.identity_verified?

    cabinet_path
  end
end
