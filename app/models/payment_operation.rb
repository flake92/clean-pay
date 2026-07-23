class PaymentOperation < ApplicationRecord
  include AASM

  class StaleClaimError < StandardError; end

  belongs_to :web_user
  has_one :payment_record, dependent: :nullify

  enum :kind, { purchase: "PURCHASE", extend: "EXTEND" }, validate: true
  enum :status, {
    ready: "READY",
    dispatching: "DISPATCHING",
    succeeded: "SUCCEEDED",
    failed_final: "FAILED_FINAL",
    outcome_unknown: "OUTCOME_UNKNOWN",
    manual_required: "MANUAL_REQUIRED"
  }, validate: true

  validates :idempotency_key_hash, :request_fingerprint, :request_payload,
    :upstream_key, presence: true
  validates :upstream_key, uniqueness: true
  validates :idempotency_key_hash, uniqueness: { scope: :web_user_id }
  validates :dispatch_attempt_count, :reconciliation_attempt_count,
    :reconciliation_failure_count,
    numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :dispatch_lease_pair_is_complete
  validate :reconciliation_lease_pair_is_complete

  aasm column: :status, enum: true, whiny_persistence: true do
    state :ready, initial: true
    state :dispatching, :succeeded, :failed_final, :outcome_unknown,
      :manual_required

    event(:dispatch) { transitions from: :ready, to: :dispatching }
    event(:succeed) { transitions from: %i[dispatching outcome_unknown], to: :succeeded }
    event(:fail_finally) {
      transitions from: %i[dispatching outcome_unknown], to: :failed_final
    }
    event(:lose_outcome) { transitions from: :dispatching, to: :outcome_unknown }
    event(:require_manual_review) {
      transitions from: :outcome_unknown, to: :manual_required
    }
  end

  scope :reconcilable, ->(at = Time.current) {
    where(status: %w[DISPATCHING OUTCOME_UNKNOWN])
      .where(
        "status = 'OUTCOME_UNKNOWN' OR lease_expires_at IS NULL OR lease_expires_at <= ?",
        at
      )
      .where("reconciliation_next_at IS NULL OR reconciliation_next_at <= ?", at)
      .where(
        "reconciliation_lease_expires_at IS NULL OR reconciliation_lease_expires_at <= ?",
        at
      )
  }

  def claim_dispatch!(lease_for: 2.minutes, at: Time.current)
    with_lock do
      return false unless ready?

      self.claim_token = SecureRandom.uuid
      self.lease_expires_at = at + lease_for
      self.dispatched_at = at
      self.dispatch_attempt_count += 1
      dispatch
      save!
      true
    end
  end

  def settle_success!(snapshot:, at: Time.current)
    with_lock do
      self.response_snapshot = snapshot
      self.completed_at = at
      self.outcome_observed_at = at
      self.claim_token = nil
      self.lease_expires_at = nil
      succeed
      save!
    end
  end

  def settle_failure!(snapshot:, at: Time.current)
    with_lock do
      self.error_snapshot = snapshot
      self.completed_at = at
      self.outcome_observed_at = at
      self.claim_token = nil
      self.lease_expires_at = nil
      fail_finally
      save!
    end
  end

  def mark_outcome_unknown!(snapshot:, at: Time.current)
    with_lock do
      self.error_snapshot = snapshot
      self.outcome_observed_at = at
      self.reconciliation_next_at = at
      self.claim_token = nil
      self.lease_expires_at = nil
      lose_outcome if dispatching?
      save!
    end
  end

  def claim_reconciliation!(lease_for: 2.minutes, at: Time.current)
    with_lock do
      return unless reconcilable_now?(at:)

      token = SecureRandom.uuid
      update!(
        reconciliation_claim_token: token,
        reconciliation_lease_expires_at: at + lease_for,
        reconciliation_attempt_count: reconciliation_attempt_count + 1
      )
      token
    end
  end

  def defer_reconciliation!(claim:, error: nil, delay: 30.seconds,
    at: Time.current)
    with_lock do
      raise StaleClaimError unless reconciliation_claim_token == claim

      update!(
        reconciliation_claim_token: nil,
        reconciliation_lease_expires_at: nil,
        reconciliation_next_at: at + delay,
        reconciliation_failure_count:
          reconciliation_failure_count + (error ? 1 : 0),
        reconciliation_last_error: error
      )
      true
    end
  end

  def require_manual_review!(claim:, snapshot:, at: Time.current)
    with_lock do
      raise StaleClaimError unless reconciliation_claim_token == claim

      self.response_snapshot = snapshot
      self.completed_at = at
      self.reconciled_at = at
      self.reconciliation_claim_token = nil
      self.reconciliation_lease_expires_at = nil
      if outcome_unknown?
        require_manual_review
      else
        self.status = :manual_required
      end
      save!
      true
    end
  end

  def settle_recovered_success!(claim:, snapshot:, at: Time.current)
    with_lock do
      raise StaleClaimError unless reconciliation_claim_token == claim

      self.response_snapshot = snapshot
      self.completed_at = at
      self.outcome_observed_at = at
      self.reconciled_at = at
      self.claim_token = nil
      self.lease_expires_at = nil
      self.reconciliation_claim_token = nil
      self.reconciliation_lease_expires_at = nil
      succeed
      save!
      true
    end
  end

  private

  def reconcilable_now?(at:)
    (dispatching? || outcome_unknown?) &&
      (!dispatching? || lease_expires_at.nil? || lease_expires_at <= at) &&
      (reconciliation_next_at.nil? || reconciliation_next_at <= at) &&
      (
        reconciliation_lease_expires_at.nil? ||
          reconciliation_lease_expires_at <= at
      )
  end

  def dispatch_lease_pair_is_complete
    return if claim_token.present? == lease_expires_at.present?

    errors.add(:claim_token, :invalid)
  end

  def reconciliation_lease_pair_is_complete
    return if reconciliation_claim_token.present? ==
      reconciliation_lease_expires_at.present?

    errors.add(:reconciliation_claim_token, :invalid)
  end
end
