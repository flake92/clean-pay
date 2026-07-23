module Integrations
  class TurnstileClient
    class ForbiddenError < StandardError; end
    class UnavailableError < StandardError; end

    def initialize(http: nil, config: nil)
      @config = config || Rails.application.config.x.clean_pay
      @http = http || HttpClient.new(
        base_url: @config.turnstile.verify_url,
        timeout: 10
      )
    end

    def verify!(token:, remote_ip: nil)
      return true unless turnstile.enabled
      raise UnavailableError unless turnstile.secret_key
      raise ForbiddenError if token.blank?

      response = http.request(
        :post,
        turnstile.verify_url.to_s,
        form: {
          secret: turnstile.secret_key.value,
          response: token,
          remoteip: valid_ip(remote_ip)
        }.compact
      )
      raise UnavailableError unless response.success? && response.body.is_a?(Hash)
      raise ForbiddenError unless response.body["success"] == true
      raise ForbiddenError unless response.body["hostname"].to_s.casecmp?(
        config.urls.app.host
      )

      true
    rescue HttpClient::Error
      raise UnavailableError
    end

    private

    attr_reader :http, :config

    def turnstile = config.turnstile

    def valid_ip(value)
      IPAddr.new(value).to_s if value.present?
    rescue IPAddr::InvalidAddressError
      nil
    end
  end
end
