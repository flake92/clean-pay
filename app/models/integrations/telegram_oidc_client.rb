module Integrations
  class TelegramOidcClient
    class Error < StandardError; end

    def initialize(http: nil, config: nil)
      @config = config || Rails.application.config.x.clean_pay
      @http = http || HttpClient.new(
        base_url: @config.telegram.issuer,
        timeout: 10
      )
    end

    def authorization_url(state:, nonce:, verifier:)
      query = URI.encode_www_form(
        response_type: "code",
        client_id: telegram.client_id,
        redirect_uri: callback_url,
        scope: "openid profile",
        state:,
        nonce:,
        code_challenge: Base64.urlsafe_encode64(
          Digest::SHA256.digest(verifier),
          padding: false
        ),
        code_challenge_method: "S256"
      )
      "#{telegram.authorization_endpoint}?#{query}"
    end

    def exchange(code:, verifier:)
      secret = telegram.client_secret.value
      secret = secret.delete_prefix("#{telegram.client_id}:")
      basic = Base64.strict_encode64("#{telegram.client_id}:#{secret}")
      response = http.request(
        :post,
        telegram.token_endpoint.to_s,
        form: {
          grant_type: "authorization_code",
          code:,
          redirect_uri: callback_url,
          client_id: telegram.client_id,
          code_verifier: verifier
        },
        headers: { "Authorization" => "Basic #{basic}" }
      )
      token = response.body.is_a?(Hash) && response.body["id_token"]
      raise Error unless response.success? && token.present?

      token
    rescue HttpClient::Error
      raise Error
    end

    def verify(id_token, nonce:)
      payload, = JWT.decode(
        id_token,
        nil,
        true,
        algorithms: %w[RS256],
        jwks: jwks,
        iss: telegram.issuer.to_s,
        verify_iss: true,
        aud: telegram.client_id,
        verify_aud: true
      )
      raise Error unless
        ActiveSupport::SecurityUtils.secure_compare(payload["nonce"].to_s, nonce)

      id = Integer(payload["id"] || payload["telegram_id"], exception: false)
      raise Error unless id&.positive?

      TelegramPayload::Identity.new(
        id: id.to_s,
        first_name: payload["given_name"].presence ||
          payload["name"].presence ||
          payload["preferred_username"].presence ||
          "Telegram",
        last_name: payload["family_name"].presence,
        username: payload["preferred_username"].presence,
        photo_url: payload["picture"].presence,
        auth_date: Time.current.to_i
      )
    rescue JWT::DecodeError
      raise Error
    end

    def jwks
      Rails.cache.fetch("telegram:oidc:jwks", expires_in: 5.minutes) do
        response = http.request(:get, telegram.jwks_uri.to_s)
        body = response.body
        raise Error unless response.success? &&
          body.is_a?(Hash) &&
          body["keys"].is_a?(Array) &&
          body["keys"].any?

        body
      end
    rescue HttpClient::Error
      raise Error
    end

    private

    attr_reader :http, :config

    def telegram = config.telegram
    def callback_url
      URI.join(
        config.urls.app.to_s,
        "/account/telegram_authorization/callback"
      ).to_s
    end
  end
end
