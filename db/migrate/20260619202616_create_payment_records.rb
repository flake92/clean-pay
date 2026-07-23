class CreatePaymentRecords < ActiveRecord::Migration[8.1]
  def change
    create_enum :payment_purchase_type, %w[NEW RENEW CHANGE]
    create_enum :payment_status,
      %w[PENDING COMPLETED FAILED CANCELED REFUNDED UNKNOWN]

    create_table :payment_records, id: :string do |t|
      t.references :web_user, null: false, type: :string,
        foreign_key: { on_delete: :cascade }
      t.string :payment_id, null: false
      t.enum :purchase_type, enum_type: :payment_purchase_type, null: false
      t.enum :status, enum_type: :payment_status,
        null: false, default: "PENDING"
      t.decimal :final_amount, precision: 12, scale: 2, null: false
      t.string :currency, null: false
      t.string :gateway_type, null: false
      t.string :plan_id
      t.string :plan_name
      t.integer :duration_days
      t.integer :device_limit
      t.bigint :traffic_limit_bytes
      t.string :payment_url
      t.boolean :is_free, null: false, default: false
      t.jsonb :raw
      t.datetime :upstream_created_at
      t.datetime :upstream_updated_at
      t.timestamps
    end

    add_index :payment_records, :payment_id, unique: true
    add_index :payment_records, :payment_id,
      name: "index_payment_records_on_payment_id_lookup"
    add_index :payment_records, %i[web_user_id created_at]
    add_check_constraint :payment_records,
      "final_amount >= 0",
      name: "payment_records_nonnegative_amount"
  end
end
