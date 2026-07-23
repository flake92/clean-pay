module Platform
  class RetentionRunner
    HEARTBEAT = "/tmp/clean-pay-retention-heartbeat"

    def initialize(batch: RetentionBatch.new)
      config = Rails.application.config.x.clean_pay.retention
      @runner = IntervalRunner.new(
        interval: config.interval_seconds,
        task: -> {
          result = batch.call
          Rails.logger.info(
            event: "retention_completed",
            counts: result.to_h
          )
        },
        heartbeat: Heartbeat.new(HEARTBEAT)
      )
    end

    def run = runner.run
    def stop = runner.stop

    private

    attr_reader :runner
  end
end
