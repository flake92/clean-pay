module Integrations
  class RemnashopClient
    class Error < StandardError
      attr_reader :code, :status, :detail

      def initialize(code:, status:, detail:)
        @code = code
        @status = status
        @detail = detail
        super("#{code}: #{detail}")
      end
    end

    AuthResult = Data.define(
      :body,
      :access_token,
      :refresh_token,
      :remnashop_user_id
    )

    def initialize(public_http: nil, admin_http: nil, config: nil)
      @config = config || Rails.application.config.x.clean_pay
      @public_http = public_http || HttpClient.new(
        base_url: @config.remnashop.public_api
      )
      @admin_http = admin_http || HttpClient.new(
        base_url: @config.remnashop.admin_api
      )
    end

    def register(payload) = auth_request(:post, "auth/register", json: payload)
    def login(payload) = auth_request(:post, "auth/login", json: payload)
    def telegram_auth(payload) = auth_request(:post, "auth/telegram", json: payload)
    def telegram_webapp(init_data:) =
      auth_request(:post, "auth/telegram/webapp", json: { init_data: })
    def refresh(refresh_token:) =
      auth_request(:post, "auth/refresh", refresh_token:)
    def change_password(access_token:, payload:) =
      auth_request(:post, "auth/change-password", access_token:, json: payload)
    def me(access_token:) = public_request(:get, "auth/me", access_token:).body
    def link_telegram(access_token:, payload:) =
      public_request(:post, "auth/telegram/link", access_token:, json: payload).body
    def request_email_verification(access_token:, email: nil) =
      public_request(:post, "auth/email/request-verification",
        access_token:, json: { email: }.compact).body
    def confirm_email(access_token:, code:) =
      public_request(:post, "auth/email/confirm", access_token:, json: { code: }).body
    def change_email(access_token:, email:) =
      public_request(:post, "auth/email/change", access_token:, json: { email: }).body

    def public_plans = public_request(:get, "plans/public").body
    def current_subscription(access_token:) =
      public_request(:get, "subscription/current", access_token:).body
    def offers(access_token:) =
      public_request(:get, "subscription/offers", access_token:).body
    def purchase(access_token:, idempotency_key:, payload:) =
      public_request(:post, "subscription/purchase",
        access_token:, idempotency_key:, json: payload).body
    def extend_subscription(access_token:, idempotency_key:, payload:) =
      public_request(:post, "subscription/extend",
        access_token:, idempotency_key:, json: payload).body
    def reissue(access_token:) =
      public_request(:post, "subscription/reissue", access_token:).body
    def activate_promocode(access_token:, code:) =
      public_request(:post, "subscription/promocode",
        access_token:, json: { code: }).body
    def devices(access_token:) =
      public_request(:get, "subscription/devices", access_token:).body
    def delete_devices(access_token:) =
      public_request(:delete, "subscription/devices", access_token:).body
    def delete_device(access_token:, hwid:) =
      public_request(:delete,
        "subscription/devices/#{ERB::Util.url_encode(hwid)}",
        access_token:).body

    def capabilities(access_token:) =
      optional_public(:get, "subscription/capabilities", access_token:)
    def transaction_page(access_token:, limit:, cursor: nil)
      query = URI.encode_www_form({ limit:, cursor: }.compact)
      public_request(:get, "subscription/transactions/page?#{query}",
        access_token:).body
    end
    def transaction(access_token:, payment_id:) =
      optional_public(:get,
        "subscription/transactions/by-id/#{ERB::Util.url_encode(payment_id)}",
        access_token:)
    def transactions(access_token:) =
      public_request(:get, "subscription/transactions", access_token:).body
    def payment_recovery(access_token:, operation:, idempotency_key:, trigger: false)
      optional_public(trigger ? :post : :get,
        "subscription/payment-operations/#{operation}",
        access_token:, idempotency_key:)
    end

    def merge_users(payload:, dry_run:)
      admin_request(:post, "users/merge?dry_run=#{dry_run}", json: payload).body
    end
    def admin_payment_recovery(operation:, user_id:, idempotency_key:,
      trigger: false)
      query = URI.encode_www_form(user_id:)
      optional_admin(trigger ? :post : :get,
        "payment-operations/#{operation}?#{query}",
        idempotency_key:)
    end

    private

    attr_reader :public_http, :admin_http, :config

    def auth_request(method, path, access_token: nil, refresh_token: nil, json: nil)
      response = public_request(method, path,
        access_token:, refresh_token:, json:)
      access = cookie(response.headers, "access_token")
      refresh = cookie(response.headers, "refresh_token")
      raise normalized_error(502, "missing upstream auth cookies", path) unless
        access && refresh

      claims, = JWT.decode(access, nil, false)
      owner = claims["sub"].to_s.presence
      raise normalized_error(502, "missing upstream token subject", path) unless owner

      AuthResult.new(
        body: response.body,
        access_token: access,
        refresh_token: refresh,
        remnashop_user_id: owner
      )
    rescue JWT::DecodeError
      raise normalized_error(502, "invalid upstream access token", path)
    end

    def public_request(method, path, access_token: nil, refresh_token: nil,
      idempotency_key: nil, json: nil)
      headers = auth_headers(access_token:, refresh_token:, idempotency_key:)
      response = public_http.request(method, path, json:, headers:)
      raise normalized_error(response.status, detail(response.body), path) unless
        response.success?

      response
    rescue HttpClient::Error => error
      raise normalized_error(502, error.message, path)
    end

    def admin_request(method, path, idempotency_key: nil, json: nil)
      headers = {
        "X-API-Key" => config.remnashop.api_key&.value,
        "Idempotency-Key" => idempotency_key
      }.compact
      response = admin_http.request(method, path, json:, headers:)
      raise normalized_error(response.status, detail(response.body), path) unless
        response.success?

      response
    rescue HttpClient::Error => error
      raise normalized_error(502, error.message, path)
    end

    def optional_public(method, path, **options)
      public_request(method, path, **options).body
    rescue Error => error
      raise unless error.status == 404
    end

    def optional_admin(method, path, **options)
      admin_request(method, path, **options).body
    rescue Error => error
      raise unless error.status == 404
    end

    def auth_headers(access_token:, refresh_token:, idempotency_key:)
      cookie_value =
        if access_token
          "access_token=#{access_token}"
        elsif refresh_token
          "refresh_token=#{refresh_token}"
        end
      {
        "Cookie" => cookie_value,
        "Idempotency-Key" => idempotency_key
      }.compact
    end

    def cookie(headers, name)
      values = headers.to_h.filter_map do |key, value|
        value if key.to_s.downcase == "set-cookie"
      end.flatten.join(",")
      values[/\b#{Regexp.escape(name)}=([^;,\s]+)/, 1]
    end

    def detail(body)
      value = body.is_a?(Hash) ? body["detail"] : body
      case value
      when String then value
      when Array then value.filter_map {
        |item| item.is_a?(Hash) ? item["msg"] : item.to_s
      }.join(", ")
      when Hash then value.values_at("message", "error", "detail").compact.first
      else "Request failed"
      end
    end

    def normalized_error(status, message, path)
      text = message.to_s.downcase
      code, public_status =
        case status
        when 401
          [ path == "auth/login" ? "AUTH_FAILED" : "UNAUTHORIZED", 401 ]
        when 403 then [ "FORBIDDEN", 403 ]
        when 404 then [ "NOT_FOUND", 404 ]
        when 409
          if text.include?("email") && text.include?("verified")
            [ "EMAIL_NOT_VERIFIED", 409 ]
          elsif text.include?("idempotency") && text.include?("different")
            [ "IDEMPOTENCY_KEY_REUSED", 409 ]
          else
            [ "CONFLICT", 409 ]
          end
        when 400, 422 then [ "VALIDATION_ERROR", 400 ]
        when 429 then [ "RATE_LIMITED", 429 ]
        when 500..599 then [ "UPSTREAM_UNAVAILABLE", 502 ]
        else [ "UPSTREAM_ERROR", 502 ]
        end
      Error.new(code:, status: public_status, detail: message.to_s)
    end
  end
end
