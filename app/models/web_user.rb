class WebUser < ApplicationRecord
  EMAIL_PATTERN = URI::MailTo::EMAIL_REGEXP

  has_many :web_sessions, dependent: :destroy
  has_many :web_authn_credentials, dependent: :destroy
  has_many :web_authn_challenges, dependent: :destroy
  has_many :email_verification_codes, dependent: :destroy
  has_many :telegram_auth_states, dependent: :nullify
  has_many :account_merge_confirmations, dependent: :destroy
  has_many :payment_operations, dependent: :restrict_with_error
  has_many :payment_records, dependent: :destroy
  has_one :payment_history_sync_state, dependent: :destroy
  has_many :audit_logs, dependent: :nullify

  normalizes :email, :pending_remnashop_email,
    with: ->(value) { value.strip.downcase.presence }
  normalizes :telegram_id, :remnashop_user_id, :pending_remnashop_user_id,
    with: ->(value) { value.strip.presence }

  validates :email, format: { with: EMAIL_PATTERN }, allow_nil: true
  validates :pending_remnashop_email, format: { with: EMAIL_PATTERN }, allow_nil: true
  validates :email, :telegram_id, :remnashop_user_id,
    uniqueness: { case_sensitive: true }, allow_nil: true

  def identity_verified?
    email_verified? || telegram_id.present?
  end
end
