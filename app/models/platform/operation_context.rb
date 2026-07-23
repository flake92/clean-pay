module Platform
  OperationContext = Data.define(
    :request_id,
    :web_user_id,
    :web_session_id,
    :ip_hash,
    :user_agent
  ) do
    def self.current
      new(
        request_id: Current.request_id,
        web_user_id: Current.web_user&.id,
        web_session_id: Current.web_session&.id,
        ip_hash: Current.ip_hash,
        user_agent: Current.user_agent
      )
    end

    def audit_attributes
      {
        web_user_id:,
        ip_hash:,
        metadata: {
          "request_id" => request_id,
          "web_session_id" => web_session_id
        }.compact
      }
    end
  end
end
