class Account::RegistrationsController < ApplicationController
  def create
    body = params.expect(
      registration: [
        :email,
        :password,
        :password_confirmation,
        :turnstile_token,
        :"cf-turnstile-response"
      ]
    )
    verify_turnstile!(body)
    raise ErrorHandling::Error.new(
      "VALIDATION_ERROR",
      status: :bad_request
    ) unless body[:password].present? &&
      body[:password] == body[:password_confirmation]

    result = Identity::EmailAuthentication.new.register!(
      body.except(
        :password_confirmation,
        :turnstile_token,
        :"cf-turnstile-response"
      ).to_h
    )
    Identity::EmailVerification.new.request!(
      web_session: result.tokens.web_session,
      email: result.web_user.email
    )
    write_session_cookies(result.tokens)
    redirect_to register_verify_email_path, status: :see_other
  end
end
