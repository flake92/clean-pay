require "json"
require "time"

module CleanPay
  class JsonLogFormatter
    def call(severity, time, progname, message)
      record =
        message.is_a?(Hash) ? message : fallback_record(severity, progname, message)
      filtered = parameter_filter.filter(record)
      filtered[:timestamp] ||= time.utc.iso8601(6)
      filtered[:level] ||= severity.downcase
      "#{JSON.generate(filtered)}\n"
    end

    private

    def fallback_record(severity, progname, message)
      {
        level: severity.downcase,
        event: "rails.log",
        category: "framework",
        source: progname || "rails",
        message: message.respond_to?(:to_hash) ? message.to_hash : message.to_s
      }
    end

    def parameter_filter
      @parameter_filter ||=
        ActiveSupport::ParameterFilter.new(
          Rails.application.config.filter_parameters
        )
    end
  end

  class JsonEventSubscriber
    def initialize(logger: Rails.logger)
      @logger = logger
    end

    def emit(event)
      @logger.info(
        event: event.fetch(:name),
        category: event.fetch(:name).split(".", 2).first,
        source: "rails.event",
        timestamp: Time.at(event.fetch(:timestamp) / 1_000_000_000.0).utc.iso8601(6),
        payload: serialize(event[:payload]),
        context: event[:context] || {},
        tags: event[:tags] || {}
      )
    end

    private

    def serialize(payload)
      payload.respond_to?(:serialize) ? payload.serialize : payload
    end
  end
end

if Rails.env.production?
  logger = ActiveSupport::Logger.new(STDOUT)
  logger.formatter = CleanPay::JsonLogFormatter.new
  Rails.application.config.logger = ActiveSupport::TaggedLogging.new(logger)
end

Rails.event.subscribe(CleanPay::JsonEventSubscriber.new)
