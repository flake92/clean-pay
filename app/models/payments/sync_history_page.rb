module Payments
  class SyncHistoryPage
    class OwnershipConflictError < StandardError; end
    class ContractError < StandardError; end

    def initialize(client: Integrations::RemnashopClient.new)
      @client = client
    end

    def call!(web_session:, limit: 20)
      token = access_token!(web_session)
      user = web_session.web_user
      owner = owner_hash(user)
      state = PaymentHistorySyncState.find_or_create_by!(web_user: user) do |item|
        item.upstream_owner_hash = owner
      end
      raise OwnershipConflictError unless state.upstream_owner_hash == owner

      claim = state.claim!
      return user.payment_records.recent_first.limit(limit) unless claim

      items, cursor = fetch_page(token:, state:)
      PaymentRecord.transaction do
        items.each do |attributes|
          PaymentRecord.upsert_upstream!(
            web_user: user,
            attributes: PaymentRecord.validate_transaction!(attributes)
          )
        end
        state.advance!(claim:, cursor:, complete: cursor.nil?)
      end
      user.payment_records.recent_first.limit(limit)
    rescue Integrations::RemnashopClient::Error => error
      state&.fail!(
        claim:,
        error: { "code" => error.code, "status" => error.status }
      ) if claim
      raise
    rescue KeyError, ArgumentError, ActiveModel::ValidationError
      state&.fail!(
        claim:,
        error: { "code" => "UPSTREAM_ERROR" }
      ) if claim
      raise ContractError
    rescue PaymentHistorySyncState::StaleClaimError
      raise ContractError
    end

    private

    attr_reader :client

    def fetch_page(token:, state:)
      capabilities = client.capabilities(access_token: token)
      if paginated?(capabilities)
        maximum = Integer(
          capabilities.dig("transactions", "max_page_size"),
          exception: false
        )
        raise ContractError unless maximum&.between?(1, 100)

        page = client.transaction_page(
          access_token: token,
          limit: [ maximum, 100 ].min,
          cursor: state.cursor
        )
        raise ContractError unless page.is_a?(Hash)
        raise ContractError unless page["items"].is_a?(Array)

        [ page["items"], page["next_cursor"].presence ]
      else
        items = client.transactions(access_token: token)
        raise ContractError unless items.is_a?(Array)

        [ items, nil ]
      end
    end

    def paginated?(capabilities)
      return false if capabilities.nil?
      raise ContractError unless capabilities.is_a?(Hash)

      capabilities["contract_version"] == 1 &&
        capabilities.dig("transactions", "keyset_pagination") == true
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

    def owner_hash(web_user)
      secret =
        Rails.application.config.x.clean_pay.security
          .rate_limit_identity_secret&.value ||
        Rails.application.key_generator.generate_key("payment-owner", 32)
      OpenSSL::HMAC.hexdigest(
        "SHA256",
        secret,
        web_user.remnashop_user_id.to_s
      )
    end
  end
end
