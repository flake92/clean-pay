class Account::Passkeys::RegistrationsController < ApplicationController
  before_action :require_session!

  def create
    authorize :identity, :manage_passkeys?, policy_class: IdentityPolicy
    options = ceremony.registration_options(web_user: Current.web_user)
    render_protocol_data(
      options.as_json.except("excludeCredentials", :excludeCredentials)
    )
  end

  def update
    authorize :identity, :manage_passkeys?, policy_class: IdentityPolicy
    body = protocol_json_body!
    name = body.delete("name")
    ceremony.register!(web_user: Current.web_user, payload: body, name:)
    promote_bootstrap_session!
    render_protocol_data(success: true)
  rescue Identity::PasskeyCeremony::InvalidCeremonyError
    raise ErrorHandling::Error.new("VALIDATION_ERROR", status: :bad_request)
  rescue Identity::PasskeyCeremony::OwnershipConflictError
    raise ErrorHandling::Error.new("CONFLICT", status: :conflict)
  end

  private

  def ceremony = Identity::PasskeyCeremony.new

  def promote_bootstrap_session!
    return unless Current.web_session.bootstrap?

    Current.web_session.update!(
      assurance_level: :full,
      auth_method: :passkey
    )
    access_token = session_authenticator.reissue_access!(Current.web_session)
    write_access_cookie(access_token, Current.web_session)
  end
end
