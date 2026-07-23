class RateLimitEvent < ApplicationRecord
  validates :key, :action, :occurred_at, presence: true

  scope :older_than, ->(time) { where(occurred_at: ...time) }
end
