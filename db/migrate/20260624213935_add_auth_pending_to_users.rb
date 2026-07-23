class AddAuthPendingToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :web_users, :auth_pending, :boolean,
      null: false, default: false
  end
end
