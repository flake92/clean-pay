class Account::EmailsController < ApplicationController
  def update
    require_full_session!
    body = params.expect(
      email: [
        :value,
        :turnstile_token,
        :"cf-turnstile-response"
      ]
    )
    verify_turnstile!(body)
    result = Identity::EmailVerification.new.change!(
      web_session: Current.web_session,
      email: body[:value]
    )
    redirect_to verify_email_path,
      notice: "Проверьте новый e-mail.",
      status: :see_other
  rescue ActiveModel::ValidationError
    raise ErrorHandling::Error.new("VALIDATION_ERROR", status: :bad_request)
  end
end
