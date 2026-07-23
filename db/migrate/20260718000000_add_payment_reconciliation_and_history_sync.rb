class AddPaymentReconciliationAndHistorySync < ActiveRecord::Migration[8.1]
  def change
    add_column :payment_operations, :reconciliation_attempt_count, :integer,
      null: false, default: 0
    add_column :payment_operations, :reconciliation_failure_count, :integer,
      null: false, default: 0
    add_column :payment_operations, :reconciliation_claim_token, :string
    add_column :payment_operations, :reconciliation_lease_expires_at, :datetime
    add_column :payment_operations, :reconciliation_next_at, :datetime
    add_column :payment_operations, :reconciliation_last_error, :jsonb
    add_column :payment_operations, :reconciled_at, :datetime

    safety_assured do
      add_index :payment_operations,
        %i[reconciliation_next_at reconciliation_lease_expires_at],
        name: "index_payment_operations_on_reconciliation_queue"
      add_check_constraint :payment_operations,
        "(reconciliation_claim_token IS NULL) = (reconciliation_lease_expires_at IS NULL)",
        name: "payment_operations_reconciliation_lease_pair"
      add_check_constraint :payment_operations,
        "reconciliation_attempt_count >= 0 AND reconciliation_failure_count >= 0",
        name: "payment_operations_nonnegative_reconciliation_counts"

      add_index :payment_records,
        %i[web_user_id upstream_created_at payment_id],
        name: "index_payment_records_on_user_upstream_chronology"
    end

    create_table :payment_history_sync_states, id: false do |t|
      t.string :web_user_id, null: false, primary_key: true
      t.string :upstream_owner_hash, null: false
      t.string :cursor
      t.integer :generation, null: false, default: 0
      t.integer :attempt_count, null: false, default: 0
      t.integer :failure_count, null: false, default: 0
      t.string :claim_token
      t.datetime :lease_expires_at
      t.datetime :next_attempt_at
      t.datetime :last_attempt_at
      t.datetime :synced_at
      t.datetime :backfill_completed_at
      t.jsonb :error_snapshot
      t.timestamps
    end

    safety_assured do
      add_foreign_key :payment_history_sync_states, :web_users,
        column: :web_user_id,
        on_delete: :cascade
    end
    add_index :payment_history_sync_states,
      %i[next_attempt_at lease_expires_at],
      name: "index_payment_history_sync_states_on_claim_queue"
    add_check_constraint :payment_history_sync_states,
      "(claim_token IS NULL) = (lease_expires_at IS NULL)",
      name: "payment_history_sync_states_lease_pair"
    add_check_constraint :payment_history_sync_states,
      "generation >= 0 AND attempt_count >= 0 AND failure_count >= 0",
      name: "payment_history_sync_states_nonnegative_counters"
  end
end
