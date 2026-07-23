class CreateRefreshTokenPredecessors < ActiveRecord::Migration[8.1]
  def change
    add_column :web_sessions, :refresh_rotated_at, :datetime

    create_table :web_refresh_tokens, id: :string do |t|
      t.references :web_session, null: false, type: :string,
        foreign_key: { on_delete: :cascade }
      t.string :token_hash, null: false
      t.text :successor_token, null: false
      t.datetime :grace_expires_at, null: false
      t.datetime :consumed_at, null: false
      t.datetime :created_at, null: false
    end

    add_index :web_refresh_tokens, :token_hash, unique: true
    add_index :web_refresh_tokens, :grace_expires_at
  end
end
