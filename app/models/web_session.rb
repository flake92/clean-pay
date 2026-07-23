class WebSession < ApplicationRecord
  belongs_to :web_user
  has_many :web_refresh_tokens, dependent: :destroy

  encrypts :remnashop_access_token
  encrypts :remnashop_refresh_token

  enum :assurance_level, { bootstrap: "BOOTSTRAP", full: "FULL" }, validate: true
  enum :auth_method, { email: "EMAIL", telegram: "TELEGRAM", passkey: "PASSKEY" },
    validate: true

  validates :refresh_token_hash, presence: true, uniqueness: true
  validates :access_expires_at, :refresh_expires_at, presence: true
  validate :refresh_outlives_access

  scope :active, -> {
    where(revoked_at: nil).where("refresh_expires_at > ?", Time.current)
  }

  def active?
    revoked_at.nil? && refresh_expires_at.future?
  end

  def access_active?
    active? && access_expires_at.future?
  end

  def revoke!(at: Time.current)
    update!(revoked_at: at)
  end

  def take_remnashop_token_custody!(access_token:, refresh_token:,
    access_expires_at:, refresh_expires_at:)
    self.class.transaction do
      web_user.lock!
      sessions = web_user.web_sessions.active.order(:id).lock
      sessions.reject { |session| session.id == id }.each do |session|
        session.update!(
          remnashop_access_token: nil,
          remnashop_refresh_token: nil,
          remnashop_access_token_expires_at: nil,
          remnashop_refresh_token_expires_at: nil
        )
      end
      update!(
        remnashop_access_token: access_token,
        remnashop_refresh_token: refresh_token,
        remnashop_access_token_expires_at: access_expires_at,
        remnashop_refresh_token_expires_at: refresh_expires_at
      )
    end
  end

  private

  def refresh_outlives_access
    return if access_expires_at.blank? || refresh_expires_at.blank?
    return if refresh_expires_at >= access_expires_at

    errors.add(:refresh_expires_at, :invalid)
  end
end
