module ErrorHandling
  extend ActiveSupport::Concern

  class Error < StandardError
    attr_reader :code, :status

    def initialize(code, status:, message: nil)
      @code = code
      @status = status
      super(message || "")
    end
  end

  PUBLIC_MESSAGES = {
    "UNAUTHORIZED" => "Войдите в аккаунт, чтобы продолжить.",
    "AUTH_FAILED" => "Не удалось войти. Проверьте данные.",
    "CURRENT_PASSWORD_INVALID" => "Текущий пароль неверный.",
    "FORBIDDEN" => "Действие недоступно.",
    "NOT_FOUND" => "Данные не найдены.",
    "VALIDATION_ERROR" => "Проверьте введённые данные.",
    "EMAIL_NOT_VERIFIED" => "Подтвердите e-mail, чтобы продолжить.",
    "RATE_LIMITED" => "Слишком много попыток.",
    "CONFLICT" => "Операция конфликтует с текущими данными.",
    "OFFER_CHANGED" => "Предложение изменилось. Подтвердите покупку ещё раз.",
    "IDEMPOTENCY_KEY_REUSED" => "Эта отправка уже использована с другими данными.",
    "UPSTREAM_UNAVAILABLE" => "Сервис временно недоступен.",
    "UPSTREAM_ERROR" => "Внешний сервис вернул некорректный ответ.",
    "INTERNAL_ERROR" => "Не удалось выполнить операцию."
  }.freeze

  included do
    rescue_from ErrorHandling::Error, with: :render_request_error
    rescue_from Integrations::RemnashopClient::Error,
      with: :render_upstream_error
    rescue_from ActionDispatch::Http::Parameters::ParseError,
      with: :render_invalid_json
    rescue_from ActionController::ParameterMissing,
      with: -> { render_error("VALIDATION_ERROR", status: :bad_request) }
    rescue_from ActiveRecord::RecordNotFound,
      with: -> { render_error("NOT_FOUND", status: :not_found) }
    rescue_from Pundit::NotAuthorizedError,
      with: -> { render_error("FORBIDDEN", status: :forbidden) }
    rescue_from Integrations::TurnstileClient::ForbiddenError,
      with: -> { render_error("FORBIDDEN", status: :forbidden) }
    rescue_from Integrations::TurnstileClient::UnavailableError,
      with: -> {
        render_error("UPSTREAM_UNAVAILABLE", status: :service_unavailable)
      }
    rescue_from Payments::CreateOperation::ValidationError,
      with: -> { render_error("VALIDATION_ERROR", status: :bad_request) }
    rescue_from Payments::CreateOperation::OfferChangedError,
      with: -> { render_error("OFFER_CHANGED", status: :conflict) }
    rescue_from Payments::CreateOperation::IdempotencyConflictError,
      with: -> {
        render_error("IDEMPOTENCY_KEY_REUSED", status: :conflict)
      }
    rescue_from Payments::SyncHistoryPage::OwnershipConflictError,
      with: -> { render_error("CONFLICT", status: :conflict) }
    rescue_from Payments::SyncHistoryPage::ContractError,
      with: -> { render_error("UPSTREAM_ERROR", status: :bad_gateway) }
  end

  private

  def render_protocol_data(data = nil, status: :ok, **attributes)
    data = attributes if data.nil?
    render json: { data: }, status:
  end

  def render_error(code, status:, message: nil, debug: nil)
    public_message = message || PUBLIC_MESSAGES.fetch(
      code,
      PUBLIC_MESSAGES.fetch("INTERNAL_ERROR")
    )
    if request.format.json?
      error = { code:, message: public_message }
      error[:debug] = debug if debug && !Rails.env.production?
      render json: { error: }, status:
    else
      redirect_to(
        error_fallback_path(code),
        alert: public_message,
        status: :see_other
      )
    end
  end

  def protocol_json_body!(limit: 131_072)
    content_type = request.media_type.to_s.downcase
    unless content_type == "application/json" ||
        content_type.match?(%r{\Aapplication/[^;]+\+json\z})
      raise Error.new(
        "VALIDATION_ERROR",
        status: :unsupported_media_type,
        message: "Для этого запроса требуется application/json."
      )
    end

    body = request.raw_post.dup.force_encoding(Encoding::UTF_8)
    raise Error.new("VALIDATION_ERROR", status: :content_too_large) if
      body.bytesize > limit
    raise Error.new("VALIDATION_ERROR", status: :bad_request) if body.blank? ||
      !body.valid_encoding?

    value = JSON.parse(body)
    raise Error.new("VALIDATION_ERROR", status: :bad_request) unless
      value.is_a?(Hash)

    value
  rescue JSON::ParserError
    raise Error.new("VALIDATION_ERROR", status: :bad_request)
  end

  def error_fallback_path(code)
    case code
    when "UNAUTHORIZED", "AUTH_FAILED" then login_path
    when "EMAIL_NOT_VERIFIED" then verify_email_path
    else root_path
    end
  end

  def render_request_error(error)
    render_error(
      error.code,
      status: error.status,
      message: error.message.presence
    )
  end

  def render_upstream_error(error)
    render_error(
      error.code,
      status: error.status,
      debug: error.detail
    )
  end

  def render_invalid_json(error)
    render_error(
      "VALIDATION_ERROR",
      status: :bad_request,
      debug: error.message
    )
  end
end
