class AddEncryptedRemnashopTokensToSessions < ActiveRecord::Migration[8.1]
  def change
    add_column :web_sessions, :remnashop_access_token, :text
    add_column :web_sessions, :remnashop_refresh_token, :text
    add_column :web_sessions, :remnashop_access_token_expires_at, :datetime
    add_column :web_sessions, :remnashop_refresh_token_expires_at, :datetime

    safety_assured do
      add_index :web_sessions, :remnashop_access_token_expires_at,
        name: "index_web_sessions_on_remnashop_access_expiry"
      add_index :web_sessions, :remnashop_refresh_token_expires_at,
        name: "index_web_sessions_on_remnashop_refresh_expiry"
    end
  end
end
