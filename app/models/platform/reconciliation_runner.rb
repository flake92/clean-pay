module Platform
  class ReconciliationRunner
    HEARTBEAT = "/tmp/clean-pay-reconciliation-heartbeat"

    def initialize(http: nil)
      @config = Rails.application.config.x.clean_pay.reconciliation
      @http = http || build_http
    end

    def enabled? = config.enabled

    def run
      return unless enabled?

      @runner = IntervalRunner.new(
        interval: config.interval_seconds,
        task: method(:tick),
        heartbeat: Heartbeat.new(HEARTBEAT)
      )
      runner.run
    end

    def stop = runner&.stop

    def tick
      response = http.request(
        :post,
        "",
        headers: {
          "Accept" => "application/json",
          "X-Clean-Pay-Reconciliation-Secret" => config.secret.value
        }
      )
      validate!(response)
    end

    private

    attr_reader :config, :http, :runner

    def build_http
      Integrations::HttpClient.new(
        base_url: config.internal_url,
        timeout: 45
      )
    end

    def validate!(response)
      body = response.body
      raise Integrations::HttpClient::Error, "reconciliation failed" unless
        response.success? && body.is_a?(Hash)

      %w[claimed succeeded deferred manual_required failed].each do |key|
        value = body[key]
        raise Integrations::HttpClient::Error, "invalid reconciliation result" unless
          value.is_a?(Integer) && value >= 0
      end
      raise Integrations::HttpClient::Error, "invalid history result" unless
        body["history"].is_a?(Hash)

      body
    end
  end
end
