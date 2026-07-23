class CreateCoreRecords < ActiveRecord::Migration[8.1]
  def change
    create_enum :integration_status, %w[UNKNOWN OK DEGRADED DOWN]

    create_table :web_users, id: :string do |t|
      t.string :remnashop_user_id
      t.string :email
      t.boolean :email_verified, null: false, default: false
      t.string :display_name
      t.datetime :last_login_at
      t.timestamps
    end

    add_index :web_users, :remnashop_user_id, unique: true
    add_index :web_users, :email, unique: true
    add_index :web_users, :email, name: "index_web_users_on_email_lookup"

    create_table :web_sessions, id: :string do |t|
      t.references :web_user, null: false, type: :string,
        foreign_key: { on_delete: :cascade }
      t.string :refresh_token_hash, null: false
      t.datetime :expires_at, null: false
      t.string :user_agent
      t.string :ip_hash
      t.datetime :revoked_at
      t.timestamps
    end

    add_index :web_sessions, :refresh_token_hash, unique: true
    add_index :web_sessions, :expires_at
    add_index :web_sessions, :revoked_at

    create_table :audit_logs, id: :string do |t|
      t.references :web_user, null: true, type: :string,
        foreign_key: { on_delete: :nullify }
      t.string :action, null: false
      t.string :severity, null: false, default: "INFO"
      t.string :ip_hash
      t.jsonb :metadata
      t.datetime :created_at, null: false
    end

    add_check_constraint :audit_logs,
      "severity IN ('INFO', 'WARN', 'ERROR')",
      name: "audit_logs_severity"
    add_index :audit_logs, :action
    add_index :audit_logs, :created_at

    create_table :rate_limit_events, id: :string do |t|
      t.string :key, null: false
      t.string :action, null: false
      t.datetime :occurred_at, null: false
      t.jsonb :metadata
    end

    add_index :rate_limit_events, %i[key action occurred_at]

    create_table :app_settings, id: false do |t|
      t.string :key, null: false, primary_key: true
      t.jsonb :value, null: false
      t.datetime :updated_at, null: false
    end

    create_table :integration_statuses, id: :string do |t|
      t.string :service, null: false
      t.enum :status, enum_type: :integration_status,
        null: false, default: "UNKNOWN"
      t.string :message
      t.datetime :checked_at, null: false
      t.datetime :updated_at, null: false
    end

    add_index :integration_statuses, :service, unique: true
  end
end
