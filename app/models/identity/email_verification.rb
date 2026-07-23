module Identity
  class EmailVerification
    def initialize(client: Integrations::RemnashopClient.new)
      @client = client
    end

    def request!(web_session:, email: nil)
      client.request_email_verification(
        access_token: web_session.remnashop_access_token,
        email:
      )
    end

    def confirm!(web_session:, code:)
      result = client.confirm_email(
        access_token: web_session.remnashop_access_token,
        code:
      )
      web_session.web_user.update!(
        email: result.fetch("email"),
        email_verified: true,
        auth_pending: web_session.bootstrap?
      )
      result.merge(
        "already_verified" => false,
        "account_sync_pending" => false
      )
    end

    def change!(web_session:, email:)
      normalized = EmailAddress.parse(email).to_s
      result = client.change_email(
        access_token: web_session.remnashop_access_token,
        email: normalized
      )
      web_session.web_user.update!(
        email_verified: false,
        pending_remnashop_email: result.fetch("pending_email"),
        auth_pending: true
      )
      verification = request!(web_session:, email: normalized)
      result.merge("emailVerification" => verification)
    end

    private

    attr_reader :client
  end
end
