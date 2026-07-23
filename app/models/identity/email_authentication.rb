module Identity
  class EmailAuthentication
    class OwnershipConflictError < StandardError; end

    Result = Data.define(:web_user, :tokens, :profile, :upstream_auth)

    def initialize(client: Integrations::RemnashopClient.new,
      sessions: SessionAuthenticator.new)
      @client = client
      @sessions = sessions
    end

    def login!(payload)
      complete!(
        client.login(payload),
        auth_method: :email,
        assurance_level: :full,
        auth_pending: false
      )
    end

    def register!(payload)
      upstream = client.register(payload)
      complete!(
        upstream,
        auth_method: :email,
        assurance_level: :bootstrap,
        auth_pending: true
      )
    rescue Integrations::RemnashopClient::Error => error
      raise unless error.status == 409 &&
        error.detail.downcase.include?("email") &&
        error.detail.downcase.include?("exist")

      login_payload = payload.slice(:email, :password, "email", "password")
      complete!(
        client.login(login_payload),
        auth_method: :email,
        assurance_level: :full,
        auth_pending: false
      )
    end

    def telegram_webapp!(init_data:)
      upstream = client.telegram_webapp(init_data:)
      complete!(upstream, auth_method: :telegram)
    end

    private

    attr_reader :client, :sessions

    def complete!(upstream, auth_method:, assurance_level:, auth_pending:)
      profile = client.me(access_token: upstream.access_token)
      user = reconcile_user!(
        profile,
        upstream.remnashop_user_id,
        auth_pending:
      )
      tokens = sessions.issue!(
        web_user: user,
        auth_method:,
        assurance_level:,
        upstream_auth: upstream
      )
      Result.new(web_user: user, tokens:, profile:, upstream_auth: upstream)
    end

    def reconcile_user!(profile, remnashop_user_id, auth_pending:)
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
        last_login_at: Time.current,
        auth_pending:
      )
      user
    rescue ActiveRecord::RecordNotUnique
      raise OwnershipConflictError
    end
  end
end
