module Integrations
  class MailpitClient
    def initialize(http: nil, config: nil)
      @config = config || Rails.application.config.x.clean_pay
      @http = http || build_http
    end

    def ready?
      return false unless http

      response = http.request(
        :get,
        "api/v1/messages",
        headers: {
          "Accept" => "application/json",
          "Cache-Control" => "no-cache"
        }
      )
      response.success?
    rescue HttpClient::Error
      false
    end

    private

    attr_reader :http, :config

    def build_http
      return unless config.readiness.mailpit_url

      HttpClient.new(
        base_url: config.readiness.mailpit_url,
        timeout: 5
      )
    end
  end
end
