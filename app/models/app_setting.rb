class AppSetting < ApplicationRecord
  self.primary_key = :key

  SECRET_KEY_PATTERN = /secret|token|password|credential|private|cookie/i

  validates :key, presence: true
  validates :key, length: { maximum: 160 }
  validate :value_must_not_be_nil
  validate :key_must_not_store_secrets

  private

  def key_must_not_store_secrets
    errors.add(:key, :invalid) if key&.match?(SECRET_KEY_PATTERN)
  end

  def value_must_not_be_nil
    errors.add(:value, :blank) if value.nil?
  end
end
