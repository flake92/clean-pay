class WebRefreshToken < ApplicationRecord
  belongs_to :web_session

  encrypts :successor_token

  validates :token_hash, presence: true, uniqueness: true
  validates :successor_token, :consumed_at, :grace_expires_at, presence: true
  validate :grace_follows_consumption

  def grace_active?
    grace_expires_at.future?
  end

  private

  def grace_follows_consumption
    return if consumed_at.blank? || grace_expires_at.blank?
    return if grace_expires_at >= consumed_at

    errors.add(:grace_expires_at, :invalid)
  end
end
