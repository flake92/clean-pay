class EmailVerificationCode < ApplicationRecord
  class UnavailableError < StandardError; end

  belongs_to :web_user

  validates :code_hash, :sent_at, :expires_at, presence: true
  validates :attempts,
    numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :max_attempts,
    numericality: { only_integer: true, greater_than: 0 }

  def self.issue!(web_user:, expires_in: 15.minutes, max_attempts: 5)
    code = format("%06d", SecureRandom.random_number(1_000_000))
    record = create!(
      web_user:,
      code_hash: Digest::SHA256.hexdigest(code),
      sent_at: Time.current,
      expires_at: expires_in.from_now,
      max_attempts:
    )
    [ record, code ]
  end

  def consume!(code, at: Time.current)
    accepted = false
    with_lock do
      raise UnavailableError if consumed_at.present? || expires_at <= at ||
        attempts >= max_attempts

      accepted = ActiveSupport::SecurityUtils.secure_compare(
        code_hash,
        Digest::SHA256.hexdigest(code.to_s)
      )
      if accepted
        update!(consumed_at: at)
      else
        update!(attempts: attempts + 1)
      end
    end
    raise UnavailableError unless accepted
  end
end
