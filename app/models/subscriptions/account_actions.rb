module Subscriptions
  class AccountActions
    def initialize(client: Integrations::RemnashopClient.new,
      audit: Platform::AuditWriter.new)
      @client = client
      @audit_writer = audit
    end

    def reissue(web_session:)
      audited(web_session.web_user, "subscription_reissue") do
        client.reissue(access_token: access_token!(web_session))
      end
    end

    def activate_promocode(web_session:, code:)
      audited(web_session.web_user, "promocode_activation") do
        client.activate_promocode(
          access_token: access_token!(web_session),
          code:
        )
      end
    end

    private

    attr_reader :client, :audit_writer

    def audited(web_user, action)
      record_audit(web_user, "#{action}_attempted")
      result = yield
      record_audit(web_user, "#{action}_succeeded")
      result
    rescue StandardError => error
      record_audit(web_user, "#{action}_failed", error: error.class.name)
      raise
    end

    def record_audit(web_user, action, **metadata)
      audit_writer.call(
        web_user:,
        action:,
        metadata: metadata.presence
      )
    end

    def access_token!(web_session)
      web_session.remnashop_access_token.presence ||
        raise(
          ErrorHandling::Error.new(
            "UNAUTHORIZED",
            status: :unauthorized
          )
        )
    end
  end
end
