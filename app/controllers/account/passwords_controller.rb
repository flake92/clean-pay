class Account::PasswordsController < ApplicationController
  def update
    require_verified_identity!
    body = params.expect(password: [ :current_password, :new_password ])
    upstream = Integrations::RemnashopClient.new.change_password(
      access_token: Current.web_session.remnashop_access_token,
      payload: body.to_h
    )
    auth_method = Current.web_session.auth_method
    assurance_level = Current.web_session.assurance_level
    Current.web_user.web_sessions.active.update_all(
      revoked_at: Time.current,
      updated_at: Time.current
    )
    tokens = Identity::SessionAuthenticator.new.issue!(
      web_user: Current.web_user,
      auth_method:,
      assurance_level:,
      upstream_auth: upstream,
      ip_hash: Current.ip_hash,
      user_agent: Current.user_agent
    )
    write_session_cookies(tokens)
    redirect_to profile_path,
      notice: "Пароль изменён.",
      status: :see_other
  end
end
