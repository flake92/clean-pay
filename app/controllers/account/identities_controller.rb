class Account::IdentitiesController < ApplicationController
  def create
    email = params.expect(identity: [ :email ]).fetch(:email)
    normalized = Identity::EmailAddress.parse(email).to_s
    user = WebUser.find_by(email: normalized)
    redirect_to(
      login_path(
        email: normalized,
        mode: user ? "password" : "register",
        passkey: user&.web_authn_credentials&.exists? ? "1" : nil
      ),
      status: :see_other
    )
  rescue ActiveModel::ValidationError
    raise ErrorHandling::Error.new("VALIDATION_ERROR", status: :bad_request)
  end
end
