module Platform
  class RetentionBatch
    Result = Data.define(
      :auth_states,
      :refresh_predecessors,
      :sessions,
      :audit_info,
      :audit_security,
      :rate_limits
    )

    def call(limit: 1_000, at: Time.current)
      config = Rails.application.config.x.clean_pay.retention
      auth_cutoff = config.auth_state_days.days.ago(at)
      Result.new(
        auth_states:
          delete_auth_states(limit:, cutoff: auth_cutoff),
        refresh_predecessors:
          delete_batch(
            WebRefreshToken.where(grace_expires_at: ...auth_cutoff),
            limit:
          ),
        sessions:
          delete_batch(
            WebSession.where(updated_at: ...config.session_days.days.ago(at))
              .where("revoked_at IS NOT NULL OR refresh_expires_at < ?", at),
            limit:
          ),
        audit_info:
          delete_batch(
            AuditLog.where(severity: "INFO")
              .where(created_at: ...config.audit_info_days.days.ago(at)),
            limit:
          ),
        audit_security:
          delete_batch(
            AuditLog.where(severity: %w[WARN ERROR])
              .where(created_at: ...config.audit_security_days.days.ago(at)),
            limit:
          ),
        rate_limits:
          delete_batch(
            RateLimitEvent.where(
              occurred_at: ...config.rate_limit_days.days.ago(at)
            ),
            limit:
          )
      )
    end

    private

    def delete_auth_states(limit:, cutoff:)
      [
        TelegramAuthState.where(created_at: ...cutoff)
          .where("consumed_at IS NOT NULL OR expires_at < ?", cutoff),
        WebAuthnChallenge.where(created_at: ...cutoff)
          .where("consumed_at IS NOT NULL OR expires_at < ?", cutoff),
        EmailVerificationCode.where(created_at: ...cutoff)
          .where("consumed_at IS NOT NULL OR expires_at < ?", cutoff)
      ].sum { delete_batch(_1, limit:) }
    end

    def delete_batch(relation, limit:)
      ids = relation.order(:id).limit(limit).pluck(:id)
      relation.where(id: ids).delete_all
    end
  end
end
