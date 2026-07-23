require "test_helper"

class MigrationUpgradeTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "splits existing session expiration without losing the value" do
    with_isolated_schema do |connection, migrations|
      migrations.up(20_260_619_145_932)
      expires_at = Time.utc(2026, 8, 1, 12)

      connection.execute <<~SQL
        INSERT INTO web_users (id, email_verified, created_at, updated_at)
        VALUES ('user-1', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      SQL
      connection.execute <<~SQL
        INSERT INTO web_sessions (
          id, web_user_id, refresh_token_hash, expires_at, created_at, updated_at
        )
        VALUES (
          'session-1', 'user-1', 'refresh-hash', #{connection.quote(expires_at)},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      SQL

      migrations.up(20_260_619_153_000)
      row = connection.select_one(<<~SQL)
        SELECT access_expires_at, refresh_expires_at
        FROM web_sessions
        WHERE id = 'session-1'
      SQL

      assert_equal expires_at, row.fetch("access_expires_at")
      assert_equal expires_at, row.fetch("refresh_expires_at")
      refute_includes connection.columns(:web_sessions).map(&:name), "expires_at"
    end
  end

  test "preserves positive Telegram identifiers when widening them to text" do
    with_isolated_schema do |connection, migrations|
      migrations.up(20_260_619_154_500)
      connection.execute <<~SQL
        INSERT INTO web_users (
          id, telegram_id, email_verified, created_at, updated_at
        )
        VALUES (
          'user-telegram', 123456789, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      SQL

      migrations.up(20_260_623_214_000)

      assert_equal "123456789",
        connection.select_value("SELECT telegram_id FROM web_users WHERE id = 'user-telegram'")
      assert_equal :string,
        connection.columns(:web_users).find { |column| column.name == "telegram_id" }.type
    end
  end

  private

  def with_isolated_schema
    schema = "migration_test_#{SecureRandom.hex(8)}"
    pool = ActiveRecord::Base.connection_pool
    connection = pool.lease_connection
    original_search_path = connection.schema_search_path
    connection.execute("CREATE SCHEMA #{connection.quote_table_name(schema)}")
    connection.schema_search_path = schema
    migrations = ActiveRecord::MigrationContext.new(
      Rails.root.join("db/migrate").to_s,
      ActiveRecord::SchemaMigration.new(pool),
      ActiveRecord::InternalMetadata.new(pool)
    )

    yield connection, migrations
  ensure
    connection&.schema_search_path = original_search_path if original_search_path
    connection&.execute(
      "DROP SCHEMA IF EXISTS #{connection.quote_table_name(schema)} CASCADE"
    )
    pool&.release_connection
  end
end
