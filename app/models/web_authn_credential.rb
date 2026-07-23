class WebAuthnCredential < ApplicationRecord
  class LastCredentialError < StandardError; end

  belongs_to :web_user

  validates :credential_id, :public_key, presence: true
  validates :credential_id, uniqueness: true
  validates :counter, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :transports, length: { maximum: 16 }

  before_destroy :preserve_last_credential

  def record_authentication!(new_counter:, at: Time.current)
    with_lock do
      counter_is_valid = counter.zero? && new_counter.zero? || new_counter > counter
      raise ActiveRecord::StaleObjectError, self unless counter_is_valid

      update!(counter: new_counter, last_used_at: at)
    end
  end

  private

  def preserve_last_credential
    web_user.web_authn_credentials.order(:id).lock.load
    return if web_user.web_authn_credentials.where.not(id:).exists?

    errors.add(:base, :last_credential)
    throw :abort
  end
end
