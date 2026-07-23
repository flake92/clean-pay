class AddTelegramProfileAndAuthStates < ActiveRecord::Migration[8.1]
  def change
    add_column :web_users, :telegram_id, :bigint
    add_column :web_users, :telegram_username, :string
    add_column :web_users, :full_name, :string
    add_column :web_users, :photo_url, :string

    safety_assured do
      add_index :web_users, :telegram_id, unique: true
      add_index :web_users, :telegram_id,
        name: "index_web_users_on_telegram_id_lookup"
    end

    create_table :telegram_auth_states, id: :string do |t|
      t.string :state_hash, null: false
      t.string :nonce_hash, null: false
      t.string :verifier_hash, null: false
      t.string :redirect_to
      t.references :web_user, null: true, type: :string,
        foreign_key: { on_delete: :nullify }
      t.datetime :expires_at, null: false
      t.datetime :consumed_at
      t.timestamps
    end

    add_index :telegram_auth_states, :state_hash, unique: true
    add_index :telegram_auth_states, :nonce_hash, unique: true
    add_index :telegram_auth_states, :verifier_hash, unique: true
    add_index :telegram_auth_states, :expires_at
    add_index :telegram_auth_states, :consumed_at
  end
end
