class StoreTelegramIdsAsText < ActiveRecord::Migration[8.1]
  def up
    invalid_id = select_value <<~SQL.squish
      SELECT telegram_id
      FROM web_users
      WHERE telegram_id IS NOT NULL AND telegram_id <= 0
      LIMIT 1
    SQL
    raise ActiveRecord::MigrationError, "invalid Telegram ID: #{invalid_id}" if invalid_id

    safety_assured do
      change_column :web_users, :telegram_id, :string,
        using: "telegram_id::text"
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration,
      "Telegram identifiers are opaque text and must not be narrowed"
  end
end
