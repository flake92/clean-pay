class Account::Telegram::SessionsController < ApplicationController
  def create
    body = params.expect(
      telegram_session: [ :init_data, :redirect_to ]
    )
    init_data = body.fetch(:init_data).to_s.strip
    raise ErrorHandling::Error.new(
      "VALIDATION_ERROR",
      status: :bad_request
    ) if init_data.blank?

    result = Identity::TelegramAuthentication.new.webapp!(init_data:)
    write_session_cookies(result.tokens)
    destination = SafeReturnPath.parse(
      body[:redirect_to],
      default: cabinet_path
    )
    redirect_to destination.to_s, status: :see_other
  rescue ActiveModel::ValidationError
    raise ErrorHandling::Error.new("VALIDATION_ERROR", status: :bad_request)
  end
end
