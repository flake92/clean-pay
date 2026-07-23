module Identity
  class AccountMerge
    class ConflictError < StandardError; end

    Result = Data.define(:web_user, :access_token, :replayed)

    def initialize(client: Integrations::RemnashopClient.new,
      sessions: SessionAuthenticator.new)
      @client = client
      @sessions = sessions
    end

    def call!(confirmation:, web_session:)
      return replay_result(confirmation, web_session) if confirmation.completed?

      claim = SecureRandom.uuid
      confirmation.claim!(token: claim, lease_for: 2.minutes)
      guard_local_ownership!(confirmation, web_session)
      telegram_auth = authenticate_telegram!(confirmation)
      unless telegram_auth.remnashop_user_id ==
          confirmation.target_remnashop_user_id
        perform_merge!(confirmation, telegram_auth)
        telegram_auth = authenticate_telegram!(confirmation)
      end
      guard_target!(confirmation, telegram_auth)
      finalize!(confirmation, web_session, telegram_auth)
    rescue Integrations::RemnashopClient::Error => error
      confirmation.release!(error_code: error.code) if confirmation&.processing?
      raise
    rescue ConflictError
      confirmation.finish!(error_code: "CONFLICT") if confirmation&.processing?
      raise
    end

    private

    attr_reader :client, :sessions

    def guard_local_ownership!(confirmation, web_session)
      user = confirmation.web_user
      raise ConflictError unless web_session.web_user_id == user.id
      raise ConflictError unless
        user.remnashop_user_id == confirmation.source_remnashop_user_id
      raise ConflictError if user.pending_remnashop_user_id.present?
      raise ConflictError if user.payment_operations.where(
        status: %w[DISPATCHING OUTCOME_UNKNOWN MANUAL_REQUIRED]
      ).exists?
    end

    def authenticate_telegram!(confirmation)
      token = Rails.application.config.x.clean_pay.telegram.bot_token&.value
      raise ConflictError if token.blank?

      identity = Integrations::TelegramPayload::Identity.new(
        id: confirmation.telegram_id,
        first_name: confirmation.telegram_username.presence || "Telegram",
        last_name: nil,
        username: confirmation.telegram_username,
        photo_url: nil,
        auth_date: Time.current.to_i
      )
      client.telegram_auth(identity.to_remnashop(bot_token: token))
    end

    def perform_merge!(confirmation, telegram_auth)
      raise ConflictError unless
        telegram_auth.remnashop_user_id ==
          confirmation.source_remnashop_user_id

      payload = merge_payload(confirmation)
      validate_merge!(
        client.merge_users(payload:, dry_run: true),
        confirmation,
        dry_run: true
      )
      validate_merge!(
        client.merge_users(payload:, dry_run: false),
        confirmation,
        dry_run: false
      )
    end

    def merge_payload(confirmation)
      {
        source_user_id: Integer(confirmation.source_remnashop_user_id),
        target_user_id: Integer(confirmation.target_remnashop_user_id),
        reason: "Clean Pay explicit account merge",
        email_resolution: "KEEP_TARGET",
        telegram_resolution: "KEEP_SOURCE",
        payment_resolution: "REKEY_SOURCE"
      }
    rescue ArgumentError
      raise ConflictError
    end

    def validate_merge!(body, confirmation, dry_run:)
      values = body.to_h.stringify_keys
      raise ConflictError unless values["dry_run"] == dry_run
      raise ConflictError unless
        values["source_user_id"].to_s ==
          confirmation.source_remnashop_user_id &&
        values["target_user_id"].to_s ==
          confirmation.target_remnashop_user_id
      raise ConflictError unless Array(values["conflicts"]).empty?
      raise ConflictError unless dry_run || values["requires_relogin"] == true
    end

    def guard_target!(confirmation, telegram_auth)
      raise ConflictError unless
        telegram_auth.remnashop_user_id ==
          confirmation.target_remnashop_user_id

      profile = client.me(access_token: telegram_auth.access_token)
      raise ConflictError unless profile["telegram_id"].to_s ==
        confirmation.telegram_id
      raise ConflictError unless profile["email"].to_s.casecmp?(
        confirmation.target_email
      )
      raise ConflictError unless profile["is_email_verified"] == true
    end

    def finalize!(confirmation, web_session, telegram_auth)
      user = confirmation.web_user
      WebUser.transaction do
        user.lock!
        user.update!(
          remnashop_user_id: confirmation.target_remnashop_user_id,
          email: confirmation.target_email,
          email_verified: true,
          pending_remnashop_user_id: nil,
          pending_remnashop_email: nil,
          auth_pending: false
        )
        take_token_custody!(web_session, telegram_auth)
        confirmation.finish!
      end
      Result.new(
        web_user: user,
        access_token: sessions.reissue_access!(web_session),
        replayed: false
      )
    end

    def take_token_custody!(web_session, auth)
      web_session.take_remnashop_token_custody!(
        access_token: auth.access_token,
        refresh_token: auth.refresh_token,
        access_expires_at: Time.iso8601(auth.body.fetch("expires_at")),
        refresh_expires_at:
          Time.iso8601(auth.body.fetch("refresh_expires_at"))
      )
    end

    def replay_result(confirmation, web_session)
      raise ConflictError unless web_session.web_user_id == confirmation.web_user_id

      Result.new(
        web_user: confirmation.web_user,
        access_token: sessions.reissue_access!(web_session),
        replayed: true
      )
    end
  end
end
