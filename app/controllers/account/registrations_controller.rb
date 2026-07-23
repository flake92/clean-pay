class Account::RegistrationsController < ApplicationController
  def create
    body = params.expect(
      registration: [
        :email,
        :password,
        :turnstile_token,
        :"cf-turnstile-response"
      ]
    )
    verify_turnstile!(body)
    result = Identity::EmailAuthentication.new.register!(
      body.except(:turnstile_token, :"cf-turnstile-response").to_h
    )
    write_session_cookies(result.tokens)
    redirect_to register_verify_email_path, status: :see_other
  end
end
