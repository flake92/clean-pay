class CreateAccountMergeConfirmations < ActiveRecord::Migration[8.1]
  def change
    create_enum :merge_confirmation_status,
      %w[PENDING PROCESSING COMPLETED FAILED]

    create_table :account_merge_confirmations, id: :string do |t|
      t.references :web_user, null: false, type: :string,
        foreign_key: { on_delete: :cascade }
      t.string :token_hash, null: false
      t.string :telegram_id, null: false
      t.string :telegram_username
      t.string :source_email
      t.string :target_email, null: false
      t.string :source_remnashop_user_id, null: false
      t.string :target_remnashop_user_id, null: false
      t.enum :status, enum_type: :merge_confirmation_status,
        null: false, default: "PENDING"
      t.integer :attempt_count, null: false, default: 0
      t.string :claim_token
      t.datetime :lease_expires_at
      t.string :last_error_code
      t.datetime :expires_at, null: false
      t.datetime :completed_at
      t.timestamps
    end

    add_index :account_merge_confirmations, :token_hash, unique: true
    add_index :account_merge_confirmations, :status
    add_index :account_merge_confirmations, :lease_expires_at
    add_index :account_merge_confirmations, :expires_at
    add_check_constraint :account_merge_confirmations,
      "(claim_token IS NULL) = (lease_expires_at IS NULL)",
      name: "account_merge_confirmations_lease_pair"
    add_check_constraint :account_merge_confirmations,
      "attempt_count >= 0",
      name: "account_merge_confirmations_nonnegative_attempts"
  end
end
