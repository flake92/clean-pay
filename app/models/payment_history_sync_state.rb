class PaymentHistorySyncState < ApplicationRecord
  class StaleClaimError < StandardError; end

  Claim = Data.define(:token, :generation)

  self.primary_key = :web_user_id

  belongs_to :web_user

  validates :upstream_owner_hash, presence: true
  validates :generation, :attempt_count, :failure_count,
    numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :lease_pair_is_complete

  def lease_active?(at: Time.current)
    claim_token.present? && lease_expires_at&.>(at)
  end

  def claim!(lease_for: 2.minutes, at: Time.current)
    with_lock do
      return if lease_active?(at:)
      return if next_attempt_at&.>(at)

      token = SecureRandom.uuid
      update!(
        claim_token: token,
        lease_expires_at: at + lease_for,
        attempt_count: attempt_count + 1,
        last_attempt_at: at
      )
      Claim.new(token:, generation:)
    end
  end

  def advance!(claim:, cursor:, complete:, at: Time.current)
    with_lock do
      verify_claim!(claim)
      update!(
        cursor:,
        backfill_completed_at: complete ? at : nil,
        generation: complete ? generation + 1 : generation,
        synced_at: at,
        claim_token: nil,
        lease_expires_at: nil,
        next_attempt_at: complete ? nil : at
      )
    end
  end

  def fail!(claim:, error:, delay: 30.seconds, at: Time.current)
    with_lock do
      verify_claim!(claim)
      update!(
        error_snapshot: error,
        failure_count: failure_count + 1,
        claim_token: nil,
        lease_expires_at: nil,
        next_attempt_at: at + delay
      )
    end
  end

  private

  def verify_claim!(claim)
    return if claim_token == claim.token && generation == claim.generation

    raise StaleClaimError
  end

  def lease_pair_is_complete
    return if claim_token.present? == lease_expires_at.present?

    errors.add(:claim_token, :invalid)
  end
end
