class AddPasskeysAndSessionTrust < ActiveRecord::Migration[8.1]
  def change
    add_enum_value :session_auth_method, "PASSKEY"
    create_enum :session_assurance_level, %w[BOOTSTRAP FULL]
    create_enum :webauthn_challenge_type, %w[REGISTRATION AUTHENTICATION]

    safety_assured do
      add_column :web_sessions, :assurance_level, :enum,
        enum_type: :session_assurance_level, null: false, default: "FULL"
      add_index :web_sessions, :assurance_level
    end

    create_table :web_authn_credentials, id: :string do |t|
      t.references :web_user, null: false, type: :string,
        foreign_key: { on_delete: :cascade }
      t.string :credential_id, null: false
      t.binary :public_key, null: false
      t.bigint :counter, null: false, default: 0
      t.string :transports, array: true, null: false, default: []
      t.string :aaguid
      t.string :attestation_type
      t.boolean :backup_eligible
      t.boolean :backup_state
      t.string :name
      t.datetime :last_used_at
      t.timestamps
    end

    add_index :web_authn_credentials, :credential_id, unique: true
    add_check_constraint :web_authn_credentials,
      "counter >= 0",
      name: "web_authn_credentials_nonnegative_counter"

    create_table :web_authn_challenges, id: :string do |t|
      t.string :challenge, null: false
      t.enum :challenge_type, enum_type: :webauthn_challenge_type, null: false
      t.references :web_user, null: true, type: :string,
        foreign_key: { on_delete: :cascade }
      t.datetime :expires_at, null: false
      t.datetime :consumed_at
      t.datetime :created_at, null: false
    end

    add_index :web_authn_challenges, :challenge, unique: true
    add_index :web_authn_challenges, :challenge_type
    add_index :web_authn_challenges, :expires_at
    add_index :web_authn_challenges, :consumed_at
  end
end
