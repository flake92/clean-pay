module Identity
  class SessionAuthenticator
    class InvalidTokenError < StandardError; end
    class CompromisedTokenError < InvalidTokenError; end

    Tokens = Data.define(:web_session, :access_token, :refresh_token)

    ACCESS_TTL = 15.minutes
    REFRESH_TTL = 30.days
    REFRESH_GRACE = 30.seconds

    def issue!(web_user:, auth_method:, assurance_level: :full,
      upstream_auth: nil, ip_hash: nil, user_agent: nil, at: Time.current)
      refresh_token = SecureRandom.urlsafe_base64(48)
      session = web_user.web_sessions.create!(
        auth_method:,
        assurance_level:,
        ip_hash:,
        user_agent:,
        refresh_token_hash: refresh_digest(refresh_token),
        access_expires_at: at + ACCESS_TTL,
        refresh_expires_at: at + REFRESH_TTL
      )
      store_upstream!(session, upstream_auth) if upstream_auth
      Tokens.new(
        web_session: session,
        access_token: encode_access(session, at:),
        refresh_token:
      )
    end

    def authenticate_access(token, at: Time.current)
      payload = access_verifier.verify(
        token,
        purpose: "clean-pay-access"
      )
      session = WebSession.find_by(id: payload["sid"], web_user_id: payload["sub"])
      raise InvalidTokenError unless session&.active? && session.access_expires_at > at

      session
    rescue ActiveSupport::MessageVerifier::InvalidSignature
      raise InvalidTokenError
    end

    def reissue_access!(session, at: Time.current)
      session.with_lock do
        raise InvalidTokenError unless session.active?

        session.update!(access_expires_at: at + ACCESS_TTL)
        encode_access(session, at:)
      end
    end

    def rotate!(token, at: Time.current)
      digest = refresh_digest(token)
      session = WebSession.find_by(refresh_token_hash: digest)
      return rotate_current!(session, token:, at:) if session

      replay_predecessor!(digest, at:)
    end

    private

    def rotate_current!(session, token:, at:)
      predecessor_digest = refresh_digest(token)
      session.with_lock do
        raise InvalidTokenError unless session.active? &&
          session.refresh_token_hash == predecessor_digest

        successor = SecureRandom.urlsafe_base64(48)
        session.web_refresh_tokens.create!(
          token_hash: predecessor_digest,
          successor_token: successor,
          consumed_at: at,
          grace_expires_at: at + REFRESH_GRACE
        )
        session.update!(
          refresh_token_hash: refresh_digest(successor),
          refresh_rotated_at: at,
          access_expires_at: at + ACCESS_TTL
        )
        Tokens.new(
          web_session: session,
          access_token: encode_access(session, at:),
          refresh_token: successor
        )
      end
    rescue ActiveRecord::RecordNotUnique
      rotate!(token, at:)
    rescue InvalidTokenError
      raise unless WebRefreshToken.exists?(token_hash: predecessor_digest)

      replay_predecessor!(predecessor_digest, at:)
    end

    def replay_predecessor!(digest, at:)
      predecessor = WebRefreshToken.find_by(token_hash: digest)
      raise InvalidTokenError unless predecessor

      compromised = false
      result = predecessor.with_lock do
        session = predecessor.web_session.lock!
        if predecessor.grace_expires_at > at && session.active?
          session.update!(access_expires_at: at + ACCESS_TTL)
          Tokens.new(
            web_session: session,
            access_token: encode_access(session, at:),
            refresh_token: predecessor.successor_token
          )
        else
          session.update!(revoked_at: at) unless session.revoked_at
          compromised = true
          nil
        end
      end
      raise CompromisedTokenError if compromised

      result
    end

    def encode_access(session, at:)
      access_verifier.generate(
        {
          "sub" => session.web_user_id,
          "sid" => session.id,
          "issued_at" => at.iso8601(6)
        },
        purpose: "clean-pay-access",
        expires_at: session.access_expires_at
      )
    end

    def refresh_digest(token)
      OpenSSL::HMAC.hexdigest("SHA256", refresh_secret, token)
    end

    def access_verifier
      @access_verifier ||= ActiveSupport::MessageVerifier.new(
        app_config.security.jwt_secret&.value ||
          Rails.application.key_generator.generate_key("web-access", 32),
        digest: "SHA256",
        serializer: JSON,
        url_safe: true
      )
    end

    def refresh_secret
      app_config.security.refresh_secret&.value ||
        Rails.application.key_generator.generate_key("web-refresh", 32)
    end

    def app_config = Rails.application.config.x.clean_pay

    def store_upstream!(session, auth)
      session.update!(
        remnashop_access_token: auth.access_token,
        remnashop_refresh_token: auth.refresh_token,
        remnashop_access_token_expires_at:
          Time.iso8601(auth.body.fetch("expires_at")),
        remnashop_refresh_token_expires_at:
          Time.iso8601(auth.body.fetch("refresh_expires_at"))
      )
    end
  end
end
