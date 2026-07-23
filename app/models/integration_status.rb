class IntegrationStatus < ApplicationRecord
  enum :status, {
    unknown: "UNKNOWN",
    ok: "OK",
    degraded: "DEGRADED",
    down: "DOWN"
  }, validate: true

  validates :service, :checked_at, presence: true
  validates :service, uniqueness: true

  def stale?(after:, at: Time.current)
    checked_at < at - after
  end
end
