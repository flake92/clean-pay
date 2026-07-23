module Identity
  class TelegramAuthentication
    class OwnershipConflictError < StandardError; end

    Result = Data.define(:web_user, :tokens, :profile, :upstream_auth)

    def initialize(client: Integrations::RemnashopClient.new,
      sessions: SessionAuthenticator.new)
      @client = client
      @sessions = sessions
    end

    def webapp!(init_data:)
      complete!(client.telegram_webapp(init_data:))
    end

    def oidc!(identity)
      bot_token = Rails.application.config.x.clean_pay.telegram.bot_token&.value
      raise Integrations::TelegramPayload::InvalidError if bot_token.blank?

      complete!(
        client.telegram_auth(identity.to_remnashop(bot_token:))
      )
    end

    private

    attr_reader :client, :sessions

    def complete!(upstream)
      profile = client.me(access_token: upstream.access_token)
      user = reconcile_user!(profile, upstream.remnashop_user_id)
      tokens = sessions.issue!(
        web_user: user,
        auth_method: :telegram,
        upstream_auth: upstream,
        ip_hash: Current.ip_hash,
        user_agent: Current.user_agent
      )
      Result.new(web_user: user, tokens:, profile:, upstream_auth: upstream)
    end

    def reconcile_user!(profile, remnashop_user_id)
      email = profile["email"].presence&.then { EmailAddress.parse(_1).to_s }
      telegram_id = profile["telegram_id"]&.to_s
      candidates = WebUser.where(remnashop_user_id:).or(
        WebUser.where(email:)
      ).or(
        WebUser.where(telegram_id:)
      ).distinct.to_a
      raise OwnershipConflictError if candidates.many?

      user = candidates.first || WebUser.new
      user.update!(
        remnashop_user_id:,
        email: email || user.email,
        email_verified: profile["is_email_verified"] == true,
        telegram_id: telegram_id || user.telegram_id,
        telegram_username: profile["username"] || user.telegram_username,
        display_name: profile["name"] || user.display_name,
        full_name: profile["full_name"] || user.full_name,
        photo_url: profile["photo_url"] || user.photo_url,
        last_login_at: Time.current,
        auth_pending: false
      )
      user
    rescue ActiveRecord::RecordNotUnique
      raise OwnershipConflictError
    end
  end
end
