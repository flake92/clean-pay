require "test_helper"

class SchemaContractTest < ActiveSupport::TestCase
  EXPECTED_TABLES = %w[
    account_merge_confirmations
    app_settings
    audit_logs
    email_verification_codes
    integration_statuses
    payment_history_sync_states
    payment_operations
    payment_records
    rate_limit_events
    telegram_auth_states
    web_authn_challenges
    web_authn_credentials
    web_refresh_tokens
    web_sessions
    web_users
  ].freeze

  EXPECTED_ENUMS = {
    "integration_status" => %w[UNKNOWN OK DEGRADED DOWN],
    "merge_confirmation_status" => %w[PENDING PROCESSING COMPLETED FAILED],
    "payment_operation_kind" => %w[PURCHASE EXTEND],
    "payment_operation_status" =>
      %w[READY DISPATCHING SUCCEEDED FAILED_FINAL OUTCOME_UNKNOWN MANUAL_REQUIRED],
    "payment_purchase_type" => %w[NEW RENEW CHANGE],
    "payment_status" => %w[PENDING COMPLETED FAILED CANCELED REFUNDED UNKNOWN],
    "session_assurance_level" => %w[BOOTSTRAP FULL],
    "session_auth_method" => %w[EMAIL TELEGRAM PASSKEY],
    "webauthn_challenge_type" => %w[REGISTRATION AUTHENTICATION]
  }.freeze

  test "contains exactly the fifteen application tables" do
    application_tables =
      ActiveRecord::Base.connection.tables - %w[ar_internal_metadata schema_migrations]

    assert_equal EXPECTED_TABLES, application_tables.sort
  end

  test "contains exactly the nine closed PostgreSQL enums" do
    rows = ActiveRecord::Base.connection.select_rows(<<~SQL)
      SELECT type.typname, value.enumlabel
      FROM pg_type type
      JOIN pg_enum value ON value.enumtypid = type.oid
      ORDER BY type.typname, value.enumsortorder
    SQL
    actual = rows.group_by(&:first).transform_values { |values| values.map(&:last) }

    assert_equal EXPECTED_ENUMS, actual
  end

  test "keeps natural primary keys and monetary precision" do
    connection = ActiveRecord::Base.connection
    amount = connection.columns(:payment_records).find { |column| column.name == "final_amount" }

    assert_equal "key", connection.primary_key(:app_settings)
    assert_equal "web_user_id", connection.primary_key(:payment_history_sync_states)
    assert_equal 12, amount.precision
    assert_equal 2, amount.scale
  end

  test "keeps required uniqueness, foreign keys, and database checks" do
    connection = ActiveRecord::Base.connection
    unique_indexes = EXPECTED_TABLES.flat_map do |table|
      connection.indexes(table).select(&:unique).map { |index| [ table, index.columns ] }
    end
    foreign_keys = EXPECTED_TABLES.sum { |table| connection.foreign_keys(table).size }
    checks = EXPECTED_TABLES.sum { |table| connection.check_constraints(table).size }

    assert_includes unique_indexes, [ "web_users", [ "email" ] ]
    assert_includes unique_indexes, [ "web_users", [ "telegram_id" ] ]
    assert_includes unique_indexes,
      [ "payment_operations", %w[web_user_id idempotency_key_hash] ]
    assert_equal 12, foreign_keys
    assert_equal 12, checks
  end
end
