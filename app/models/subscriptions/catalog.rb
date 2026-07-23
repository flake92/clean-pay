module Subscriptions
  class Catalog
    class ContractError < StandardError; end

    def initialize(client: Integrations::RemnashopClient.new)
      @client = client
    end

    def public_plans
      value = client.public_plans
      raise ContractError unless value.is_a?(Hash) || value.is_a?(Array)

      value
    end

    def offers(web_session:)
      require_access_token!(web_session)
      value = client.offers(
        access_token: web_session.remnashop_access_token
      )
      raise ContractError unless value.is_a?(Hash)
      raise ContractError unless value["gateways"].is_a?(Array)
      raise ContractError unless value["plans"].is_a?(Array)

      value
    end

    private

    attr_reader :client

    def require_access_token!(web_session)
      raise ErrorHandling::Error.new(
        "UNAUTHORIZED",
        status: :unauthorized
      ) if web_session.remnashop_access_token.blank?
    end
  end
end
