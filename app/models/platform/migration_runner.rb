module Platform
  class MigrationRunner
    LOCK_ID = 1_704_202_607

    def call
      connection = ActiveRecord::Base.connection
      acquired = connection.select_value(
        "SELECT pg_try_advisory_lock(#{LOCK_ID})"
      )
      raise "migration lock is busy" unless acquired

      ActiveRecord::Tasks::DatabaseTasks.migrate
      raise "pending migrations remain" if
        ActiveRecord::MigrationContext.new(
          ActiveRecord::Tasks::DatabaseTasks.migrations_paths
        ).needs_migration?
    ensure
      connection&.execute("SELECT pg_advisory_unlock(#{LOCK_ID})") if acquired
    end
  end
end
