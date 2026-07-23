class AuditLog < ApplicationRecord
  belongs_to :web_user, optional: true

  enum :severity, { info: "INFO", warn: "WARN", error: "ERROR" }, validate: true

  validates :action, presence: true

  before_update { throw :abort }
  before_destroy { throw :abort }
end
