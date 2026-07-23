module Integrations
  class HttpClient
    class Error < StandardError
      attr_reader :status, :body

      def initialize(message, status: nil, body: nil)
        @status = status
        @body = body
        super(message)
      end
    end

    Response = Data.define(:status, :headers, :body) do
      def success? = status.between?(200, 299)
    end

    def initialize(base_url:, connection: nil, timeout: nil)
      @connection = connection || build_connection(base_url, timeout:)
    end

    def request(method, path, json: nil, form: nil, headers: {})
      response = connection.public_send(method) do |request|
        request.url(path)
        request.headers.update(headers)
        request.headers["X-Request-ID"] ||= Current.request_id if Current.request_id
        if json
          request.headers["Content-Type"] = "application/json"
          request.body = JSON.generate(json)
        elsif form
          request.headers["Content-Type"] = "application/x-www-form-urlencoded"
          request.body = URI.encode_www_form(form)
        end
      end

      Response.new(
        status: response.status,
        headers: response.headers,
        body: parse_body(response.body)
      )
    rescue Faraday::TimeoutError, Faraday::ConnectionFailed => error
      raise Error, "upstream unavailable: #{error.class.name}"
    end

    private

    attr_reader :connection

    def build_connection(base_url, timeout:)
      defaults = Rails.application.config.x.http
      Faraday.new(url: base_url) do |faraday|
        faraday.options.open_timeout = timeout || defaults.open_timeout
        faraday.options.timeout = timeout || defaults.read_timeout
        faraday.options.write_timeout = timeout || defaults.write_timeout
        faraday.adapter Faraday.default_adapter
      end
    end

    def parse_body(body)
      return nil if body.blank?

      JSON.parse(body)
    rescue JSON::ParserError
      body.to_s
    end
  end
end
