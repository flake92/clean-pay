class AddPendingOwnerEvidenceToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :web_users, :pending_remnashop_user_id, :string
    add_column :web_users, :pending_remnashop_email, :string
    safety_assured do
      add_index :web_users, :pending_remnashop_user_id
    end
  end
end
