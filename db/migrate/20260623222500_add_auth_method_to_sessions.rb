class AddAuthMethodToSessions < ActiveRecord::Migration[8.1]
  def change
    create_enum :session_auth_method, %w[EMAIL TELEGRAM]
    add_column :web_sessions, :auth_method, :enum,
      enum_type: :session_auth_method, null: false, default: "EMAIL"
  end
end
