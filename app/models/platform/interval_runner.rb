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
          interruptible_sleep(wait)
        end
      end
    ensure
      ActiveRecord::Base.connection_handler.clear_active_connections!
    end

    def stop = @stopping = true

    private

    attr_reader :interval, :task, :heartbeat, :sleeper

    def interruptible_sleep(duration)
      deadline = monotonic_now + duration
      until stopping
        remaining = deadline - monotonic_now
        break unless remaining.positive?

        sleeper.call([ remaining, 1.0 ].min)
      end
    end

    def stopping = @stopping
    def monotonic_now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  end
end
