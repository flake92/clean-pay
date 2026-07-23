class Account::EmailVerificationsController < ApplicationController
  before_action :require_session!

  def create
    body = params.expect(
      email_verification: [
        :email,
        :turnstile_token,
        :"cf-turnstile-response"
      ]
    )
    verify_turnstile!(body)
    result = operation.request!(
      web_session: Current.web_session,
      email: body[:email]
    )
    redirect_to verify_email_path,
      notice: "Код отправлен на #{result.fetch('target_email')}.",
      status: :see_other
  end

  def update
    body = params.expect(
      email_verification: [
        :code,
        :registration_flow,
        :turnstile_token,
        :"cf-turnstile-response"
      ]
    )
    verify_turnstile!(body)
    code = body[:code].to_s
    raise ErrorHandling::Error.new(
      "VALIDATION_ERROR",
      status: :bad_request
    ) unless code.match?(/\A\d{6}\z/)

    registration_flow = ActiveModel::Type::Boolean.new.cast(
      body.delete(:registration_flow)
    )
    result = operation.confirm!(web_session: Current.web_session, code:)
    destination =
      if registration_flow
        passkey_setup_path
      elsif result.fetch("account_sync_pending")
        link_account_path
      else
        cabinet_path
      end
    redirect_to(
      destination,
      notice: "E-mail подтверждён.",
      status: :see_other
    )
  end

  private

  def operation = Identity::EmailVerification.new
end
