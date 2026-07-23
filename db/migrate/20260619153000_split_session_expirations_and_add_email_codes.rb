class SplitSessionExpirationsAndAddEmailCodes < ActiveRecord::Migration[8.1]
  def up
    safety_assured do
      execute "LOCK TABLE web_sessions IN ACCESS EXCLUSIVE MODE"

      add_column :web_sessions, :access_expires_at, :datetime
      add_column :web_sessions, :refresh_expires_at, :datetime
      execute <<~SQL.squish
        UPDATE web_sessions
        SET access_expires_at = expires_at,
            refresh_expires_at = expires_at
      SQL
      change_column_null :web_sessions, :access_expires_at, false
      change_column_null :web_sessions, :refresh_expires_at, false
      remove_column :web_sessions, :expires_at
      add_index :web_sessions, :access_expires_at
      add_index :web_sessions, :refresh_expires_at
    end

    create_table :email_verification_codes, id: :string do |t|
      t.references :web_user, null: false, type: :string,
        foreign_key: { on_delete: :cascade }
      t.string :code_hash, null: false
      t.integer :attempts, null: false, default: 0
      t.integer :max_attempts, null: false, default: 5
      t.datetime :sent_at, null: false
      t.datetime :expires_at, null: false
      t.datetime :consumed_at
      t.timestamps
    end

    add_check_constraint :email_verification_codes,
      "attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts",
      name: "email_verification_codes_attempts"
    add_index :email_verification_codes, :sent_at
    add_index :email_verification_codes, :expires_at
    add_index :email_verification_codes, :consumed_at
  end

  def down
    raise ActiveRecord::IrreversibleMigration,
      "session expiration split and verification history must not be discarded"
  end
end
