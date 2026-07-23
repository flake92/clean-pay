class TelegramAuthState < ApplicationRecord
  class UnavailableError < StandardError; end

  IssuedSecrets = Data.define(:state, :nonce, :verifier)

  belongs_to :web_user, optional: true

  validates :state_hash, :nonce_hash, :verifier_hash,
    presence: true, uniqueness: true
  validates :expires_at, presence: true
  validate :redirect_is_safe

  def self.issue!(web_user: nil, redirect_to: "/", expires_in: 10.minutes)
    secrets = IssuedSecrets.new(
      state: SecureRandom.urlsafe_base64(32),
      nonce: SecureRandom.urlsafe_base64(32),
      verifier: SecureRandom.urlsafe_base64(64)
    )
    record = create!(
      web_user:,
      redirect_to:,
      expires_at: expires_in.from_now,
      state_hash: digest(secrets.state),
      nonce_hash: digest(secrets.nonce),
      verifier_hash: digest(secrets.verifier)
    )
    [ record, secrets ]
  end

  def self.digest(value)
    Digest::SHA256.hexdigest(value)
  end

  def consume!(state:, nonce:, verifier:, at: Time.current)
    with_lock do
      valid = consumed_at.nil? && expires_at > at &&
        ActiveSupport::SecurityUtils.secure_compare(state_hash, self.class.digest(state)) &&
        ActiveSupport::SecurityUtils.secure_compare(nonce_hash, self.class.digest(nonce)) &&
        ActiveSupport::SecurityUtils.secure_compare(verifier_hash, self.class.digest(verifier))
      raise UnavailableError unless valid

      update!(consumed_at: at)
    end
  end

  private

  def redirect_is_safe
    return if redirect_to.nil?
    return if redirect_to.start_with?("/") &&
      !redirect_to.start_with?("//") &&
      !redirect_to.match?(/[\\\0]/)

    errors.add(:redirect_to, :invalid)
  end
end
