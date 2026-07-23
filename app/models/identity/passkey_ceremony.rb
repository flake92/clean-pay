module Identity
  class PasskeyCeremony
    class InvalidCeremonyError < StandardError; end
    class OwnershipConflictError < StandardError; end

    def registration_options(web_user:)
      options = WebAuthn::Credential.options_for_create(
        user: {
          id: web_user.id,
          name: web_user.email || web_user.telegram_username ||
            web_user.telegram_id || web_user.id,
          display_name: web_user.display_name || web_user.full_name ||
            web_user.email || "Clean Pay"
        },
        authenticator_selection: {
          resident_key: "preferred",
          user_verification: "required"
        },
        attestation: "none"
      )
      WebAuthnChallenge.create!(
        web_user:,
        challenge: options.challenge,
        challenge_type: :registration,
        expires_at: 5.minutes.from_now
      )
      options
    end

    def register!(web_user:, payload:, name: nil)
      reject_cross_origin!(payload)
      credential = WebAuthn::Credential.from_create(payload)
      challenge = find_challenge!(payload, :registration)
      raise OwnershipConflictError unless challenge.web_user_id == web_user.id

      challenge.consume!
      credential.verify(challenge.challenge, user_verification: true)
      persist_credential!(web_user, credential, name:)
    rescue WebAuthn::Error, WebAuthnChallenge::UnavailableError,
      JSON::ParserError, ArgumentError
      raise InvalidCeremonyError
    end

    def authentication_options
      options = WebAuthn::Credential.options_for_get(
        user_verification: "required",
        timeout: 60_000
      )
      WebAuthnChallenge.create!(
        challenge: options.challenge,
        challenge_type: :authentication,
        expires_at: 5.minutes.from_now
      )
      options
    end

    def authenticate!(payload:)
      reject_cross_origin!(payload)
      assertion = WebAuthn::Credential.from_get(payload)
      challenge = find_challenge!(payload, :authentication)
      challenge.consume!
      stored = WebAuthnCredential.find_by!(credential_id: assertion.id)
      assertion.verify(
        challenge.challenge,
        public_key: WebAuthn.configuration.encoder.encode(stored.public_key),
        sign_count: stored.counter,
        user_verification: true
      )
      stored.record_authentication!(new_counter: assertion.sign_count)
      stored.web_user
    rescue WebAuthn::Error, WebAuthnChallenge::UnavailableError,
      ActiveRecord::RecordNotFound, ActiveRecord::StaleObjectError,
      JSON::ParserError, ArgumentError
      raise InvalidCeremonyError
    end

    private

    def find_challenge!(payload, type)
      client_data = decoded_client_data(payload)
      WebAuthnChallenge.find_by!(
        challenge: client_data.fetch("challenge"),
        challenge_type: WebAuthnChallenge.challenge_types.fetch(type.to_s)
      )
    end

    def reject_cross_origin!(payload)
      data = decoded_client_data(payload)
      raise InvalidCeremonyError if data["crossOrigin"] == true ||
        data["topOrigin"].present?
    end

    def decoded_client_data(payload)
      encoded = payload.dig("response", "clientDataJSON").to_s
      JSON.parse(WebAuthn.configuration.encoder.decode(encoded))
    end

    def persist_credential!(web_user, credential, name:)
      existing = WebAuthnCredential.find_by(credential_id: credential.id)
      if existing
        same_key = ActiveSupport::SecurityUtils.secure_compare(
          existing.public_key,
          credential.raw_public_key
        )
        raise OwnershipConflictError unless
          existing.web_user_id == web_user.id && same_key

        return existing
      end

      web_user.web_authn_credentials.create!(
        credential_id: credential.id,
        public_key: credential.raw_public_key,
        counter: credential.sign_count,
        transports: credential.response.transports || [],
        name: normalized_name(name, credential.authenticator_attachment),
        aaguid: credential.response.aaguid,
        attestation_type: credential.response.attestation_type,
        backup_eligible: credential.backup_eligible?,
        backup_state: credential.backed_up?
      ).tap { web_user.update!(last_login_at: Time.current) }
    rescue ActiveRecord::RecordNotUnique
      raise OwnershipConflictError
    end

    def normalized_name(name, fallback)
      value = name.is_a?(String) ? name.squish.first(80) : nil
      value.presence || fallback.presence || "Ключ доступа"
    end
  end
end
