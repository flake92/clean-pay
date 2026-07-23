class RemoveRedundantIndexes < ActiveRecord::Migration[8.1]
  def up
    safety_assured do
      execute "SET LOCAL lock_timeout = '5s'"
      remove_index :web_users,
        name: "index_web_users_on_email_lookup"
      remove_index :web_users,
        name: "index_web_users_on_telegram_id_lookup"
      remove_index :payment_records,
        name: "index_payment_records_on_payment_id_lookup"
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration,
      "redundant indexes are intentionally absent"
  end
end
