module Subscriptions
  class CurrentAccess
    class ContractError < StandardError; end
    class UrlUnavailableError < StandardError; end

    def initialize(shop: Integrations::RemnashopClient.new,
      wave: Integrations::RemnawaveClient.new)
      @shop = shop
      @wave = wave
    end

    def call(web_session:)
      require_access_token!(web_session)
      value = shop.current_subscription(
        access_token: web_session.remnashop_access_token
      )
      return if value.nil?
      raise ContractError unless value.is_a?(Hash)

      url = live_url(
        subscription: value,
        web_user: web_session.web_user
      )
      raise UrlUnavailableError unless url

      value.merge("url" => url)
    end

    private

    attr_reader :shop, :wave

    def live_url(subscription:, web_user:)
      uuid = subscription["user_remna_id"].to_s.strip
      direct = normalize_user(wave.user(uuid))
      return direct[:url] if valid_direct?(direct, uuid:)

      candidates = []
      candidates.concat(wave.users_by_email(web_user.email)) if web_user.email
      if web_user.telegram_id
        candidates.concat(
          wave.users_by_telegram_id(web_user.telegram_id)
        )
      end
      matches = candidates.filter_map { normalize_user(_1) }
        .select { live?(_1) && identity_matches?(_1, web_user) }
      uuids = matches.group_by { _1[:uuid] }
      return unless uuids.one?

      urls = uuids.values.flatten.map { _1[:url] }.compact.uniq
      urls.one? ? urls.first : nil
    end

    def normalize_user(value)
      return unless value.is_a?(Hash)

      data = value.stringify_keys
      {
        uuid: data["uuid"].to_s.strip.presence,
        status: data["status"],
        email: data["email"].to_s.strip.downcase.presence,
        telegram_id: data["telegramId"]&.to_s,
        expire_at: parse_time(data["expireAt"]),
        url: safe_url(data["subscriptionUrl"] || data["subscription_url"])
      }
    end

    def valid_direct?(candidate, uuid:)
      candidate && candidate[:uuid] == uuid && live?(candidate)
    end

    def live?(candidate)
      candidate[:uuid].present? &&
        candidate[:status] == "ACTIVE" &&
        candidate[:url].present? &&
        (candidate[:expire_at].nil? || candidate[:expire_at].future?)
    end

    def identity_matches?(candidate, web_user)
      email_matches = web_user.email &&
        candidate[:email] == web_user.email.downcase
      telegram_matches = web_user.telegram_id &&
        candidate[:telegram_id] == web_user.telegram_id
      email_matches || telegram_matches
    end

    def parse_time(value)
      Time.iso8601(value) if value.present?
    rescue ArgumentError
      Time.at(0).in_time_zone
    end

    def safe_url(value)
      uri = URI.parse(value.to_s)
      return unless uri.is_a?(URI::HTTP) && uri.host.present?

      uri.to_s
    rescue URI::InvalidURIError
      nil
    end

    def require_access_token!(web_session)
      raise ErrorHandling::Error.new(
        "UNAUTHORIZED",
        status: :unauthorized
      ) if web_session.remnashop_access_token.blank?
    end
  end
end
