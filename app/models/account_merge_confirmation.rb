class AccountMergeConfirmation < ApplicationRecord
  include AASM

  class ClaimUnavailableError < StandardError; end
  class TokenUnavailableError < StandardError; end

  belongs_to :web_user

  validates :token_hash, :source_remnashop_user_id, :target_remnashop_user_id,
    :target_email, :telegram_id, :expires_at, presence: true
  validates :token_hash, uniqueness: true
  validates :attempt_count,
    numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :lease_pair_is_complete

  aasm column: :status, enum: true, whiny_persistence: true do
    state :pending, initial: true
    state :processing, :completed, :failed

    event :claim do
      transitions from: :pending, to: :processing
      transitions from: :processing, to: :processing
    end

    event :complete do
      transitions from: :processing, to: :completed
    end

    event :fail do
      transitions from: :processing, to: :failed
    end

    event :release do
      transitions from: :processing, to: :pending
    end
  end

  enum :status, {
    pending: "PENDING",
    processing: "PROCESSING",
    completed: "COMPLETED",
    failed: "FAILED"
  }, validate: true

  def expired?(at: Time.current)
    expires_at <= at
  end

  def masked_target_email
    local, domain = target_email.to_s.split("@", 2)
    return "•••" unless local.present? && domain.present?

    "#{local.first}#{'•' * [ local.length - 1, 3 ].min}@#{domain}"
  end

  def self.issue!(web_user:, **attributes)
    token = SecureRandom.urlsafe_base64(48)
    record = web_user.account_merge_confirmations.create!(
      attributes.merge(
        token_hash: digest(token),
        expires_at: attributes[:expires_at] || 10.minutes.from_now
      )
    )
    [ record, token ]
  end

  def self.resolve!(token:, web_user:, at: Time.current)
    record = find_by(token_hash: digest(token), web_user:)
    raise TokenUnavailableError unless
      record && !record.expired?(at:) && !record.failed?

    record
  end

  def self.digest(token)
    Digest::SHA256.hexdigest(token.to_s)
  end

  def claim!(token:, lease_for:, at: Time.current)
    with_lock do
      raise ClaimUnavailableError if expired?(at:) || lease_active?(at:)

      self.claim_token = token
      self.lease_expires_at = at + lease_for
      self.attempt_count += 1
      claim
      save!
    end
  end

  def finish!(error_code: nil, at: Time.current)
    with_lock do
      if error_code
        self.last_error_code = error_code
        fail
      else
        self.completed_at = at
        complete
      end
      self.claim_token = nil
      self.lease_expires_at = nil
      save!
    end
  end

  def release!(error_code:, at: Time.current)
    with_lock do
      raise ClaimUnavailableError unless processing?

      self.last_error_code = error_code
      self.claim_token = nil
      self.lease_expires_at = nil
      release
      save!
    end
  end

  def cancel!
    with_lock do
      raise ClaimUnavailableError unless pending? && !expired?

      update!(status: :failed, last_error_code: "USER_CANCELLED")
    end
  end

  def lease_active?(at: Time.current)
    claim_token.present? && lease_expires_at&.>(at)
  end

  private

  def lease_pair_is_complete
    return if claim_token.present? == lease_expires_at.present?

    errors.add(:claim_token, :invalid)
  end
end
