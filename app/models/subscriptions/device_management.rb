module Subscriptions
  class DeviceManagement
    class ContractError < StandardError; end

    def initialize(client: Integrations::RemnashopClient.new,
      audit: Platform::AuditWriter.new)
      @client = client
      @audit = audit
    end

    def list(web_session:)
      value = client.devices(access_token: access_token!(web_session))
      raise ContractError unless value.is_a?(Hash)
      raise ContractError unless value["devices"].is_a?(Array)
      raise ContractError unless value["current_count"].is_a?(Integer)
      raise ContractError unless value["max_count"].is_a?(Integer)

      value
    end

    def delete_all(web_session:)
      audited(web_session.web_user, "devices_delete_all") do
        client.delete_devices(access_token: access_token!(web_session))
      end
    end

    def delete(web_session:, hwid:)
      audited(web_session.web_user, "device_delete", hwid:) do
        client.delete_device(
          access_token: access_token!(web_session),
          hwid:
        )
      end
    end

    private

    attr_reader :client, :audit

    def audited(web_user, action, **metadata)
      audit.call(action: "#{action}_attempted", web_user:, metadata:)
      result = yield
      audit.call(action: "#{action}_succeeded", web_user:, metadata:)
      result
    rescue StandardError => error
      audit.call(
        action: "#{action}_failed",
        web_user:,
        metadata: metadata.merge(error: error.class.name)
      )
      raise
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
