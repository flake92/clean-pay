module Integrations
  class RemnawaveClient
    def initialize(http: nil, readiness_http: nil, config: nil)
      @config = config || Rails.application.config.x.clean_pay
      @http = http || build_http
      @readiness_http = readiness_http || build_readiness_http
    end

    def user(uuid)
      response_value("api/users/#{escape(uuid)}")
    end

    def users_by_email(email)
      Array(response_value("api/users/by-email/#{escape(email)}"))
    end

    def users_by_telegram_id(telegram_id)
      Array(
        response_value("api/users/by-telegram-id/#{escape(telegram_id)}")
      )
    end

    def ready?
      return false unless readiness_http && config.remnawave.token

      response = readiness_http.request(
        :get,
        "api/system/metadata",
        headers: {
          "Accept" => "application/json",
          "Authorization" => "Bearer #{config.remnawave.token.value}"
        }
      )
      response.success?
    rescue HttpClient::Error
      false
    end

    private

    attr_reader :http, :readiness_http, :config

    def build_http
      return unless config.remnawave.api

      HttpClient.new(base_url: config.remnawave.api, timeout: 10)
    end

    def build_readiness_http
      return unless config.readiness.remnawave_url

      HttpClient.new(
        base_url: config.readiness.remnawave_url,
        timeout: 5
      )
    end

    def response_value(path)
      return unless http && config.remnawave.token

      response = http.request(
        :get,
        path,
        headers: {
          "Accept" => "application/json",
          "Authorization" => "Bearer #{config.remnawave.token.value}",
          "Cache-Control" => "no-cache"
        }
      )
      return unless response.success? && response.body.is_a?(Hash)

      response.body["response"]
    rescue HttpClient::Error
      nil
    end

    def escape(value)
      ERB::Util.url_encode(value.to_s)
    end
  end
end
