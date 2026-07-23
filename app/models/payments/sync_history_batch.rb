module Payments
  class SyncHistoryBatch
    Result = Data.define(:claimed, :succeeded, :deferred, :failed)

    def initialize(sync: SyncHistoryPage.new)
      @sync = sync
    end

    def call!(limit: 1, deadline: 12.seconds.from_now)
      counters = { claimed: 0, succeeded: 0, deferred: 0, failed: 0 }
      candidates(limit:).each do |state|
        break if Time.current >= deadline

        synchronize(state, counters:)
      end
      Result.new(**counters)
    end

    private

    attr_reader :sync

    def candidates(limit:)
      PaymentHistorySyncState
        .where(backfill_completed_at: nil)
        .where("next_attempt_at IS NULL OR next_attempt_at <= ?", Time.current)
        .where("lease_expires_at IS NULL OR lease_expires_at <= ?", Time.current)
        .order(:next_attempt_at, :web_user_id)
        .limit(limit)
    end

    def synchronize(state, counters:)
      session = state.web_user.web_sessions.active
        .where.not(remnashop_access_token: nil)
        .order(updated_at: :desc)
        .first
      unless session
        counters[:deferred] += 1
        return
      end

      attempts = state.attempt_count
      sync.call!(web_session: session)
      state.reload
      unless state.attempt_count > attempts
        counters[:deferred] += 1
        return
      end

      counters[:claimed] += 1
      counters[:succeeded] += 1
    rescue Integrations::RemnashopClient::Error, SyncHistoryPage::ContractError,
      SyncHistoryPage::OwnershipConflictError
      counters[:claimed] += 1 if state.reload.attempt_count > attempts
      counters[:failed] += 1
    end
  end
end
