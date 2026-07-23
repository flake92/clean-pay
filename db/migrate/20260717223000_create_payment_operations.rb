class CreatePaymentOperations < ActiveRecord::Migration[8.1]
  def change
    create_enum :payment_operation_kind, %w[PURCHASE EXTEND]
    create_enum :payment_operation_status,
      %w[READY DISPATCHING SUCCEEDED FAILED_FINAL OUTCOME_UNKNOWN MANUAL_REQUIRED]

    create_table :payment_operations, id: :string do |t|
      t.references :web_user, null: false, type: :string,
        foreign_key: { on_delete: :restrict }
      t.enum :kind, enum_type: :payment_operation_kind, null: false
      t.string :idempotency_key_hash, null: false
      t.string :upstream_owner_hash
      t.string :request_fingerprint, null: false
      t.jsonb :request_payload, null: false
      t.string :upstream_key, null: false
      t.enum :status, enum_type: :payment_operation_status,
        null: false, default: "READY"
      t.string :claim_token
      t.datetime :lease_expires_at
      t.integer :dispatch_attempt_count, null: false, default: 0
      t.datetime :dispatched_at
      t.datetime :outcome_observed_at
      t.datetime :completed_at
      t.jsonb :response_snapshot
      t.jsonb :error_snapshot
      t.timestamps
    end

    add_index :payment_operations,
      %i[web_user_id idempotency_key_hash],
      unique: true,
      name: "index_payment_operations_on_user_and_idempotency"
    add_index :payment_operations, :upstream_key, unique: true
    add_index :payment_operations, %i[status lease_expires_at],
      name: "index_payment_operations_on_dispatch_claim"
    add_check_constraint :payment_operations,
      "(claim_token IS NULL) = (lease_expires_at IS NULL)",
      name: "payment_operations_dispatch_lease_pair"
    add_check_constraint :payment_operations,
      "dispatch_attempt_count >= 0",
      name: "payment_operations_nonnegative_dispatch_attempts"

    safety_assured do
      add_reference :payment_records, :payment_operation,
        type: :string,
        index: { unique: true },
        foreign_key: { on_delete: :nullify }
    end
  end
end
