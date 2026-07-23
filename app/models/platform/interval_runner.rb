module Platform
  class IntervalRunner
    def initialize(interval:, task:, heartbeat:, sleeper: Kernel.method(:sleep))
      @interval = interval
      @task = task
      @heartbeat = heartbeat
      @sleeper = sleeper
      @stopping = false
    end

    def run
      until stopping
        started = monotonic_now
        begin
          Rails.application.executor.wrap { task.call }
          heartbeat.write
        rescue StandardError => error
          Rails.logger.error(
            event: "interval_task_failed",
            error_class: error.class.name
          )
        ensure
          wait = interval - (monotonic_now - started)
          sleeper.call(wait) if !stopping && wait.positive?
        end
      end
    ensure
      ActiveRecord::Base.connection_handler.clear_active_connections!
    end

    def stop = @stopping = true

    private

    attr_reader :interval, :task, :heartbeat, :sleeper

    def stopping = @stopping
    def monotonic_now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  end
end
