class Account::Passkeys::SessionsController < ApplicationController
  def create
    options = ceremony.authentication_options
    render_protocol_data(
      options.as_json.except("allowCredentials", :allowCredentials)
    )
  end

  def update
    body = protocol_json_body!
    user = ceremony.authenticate!(payload: body)
    tokens = session_authenticator.issue!(
      web_user: user,
      auth_method: :passkey,
      ip_hash: Current.ip_hash,
      user_agent: Current.user_agent
    )
    write_session_cookies(tokens)
    render_protocol_data(success: true)
  rescue Identity::PasskeyCeremony::InvalidCeremonyError
    raise ErrorHandling::Error.new("UNAUTHORIZED", status: :unauthorized)
  end

  private

  def ceremony = Identity::PasskeyCeremony.new
end
