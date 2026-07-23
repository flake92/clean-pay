module Integrations
  class TelegramPayload
    class InvalidError < StandardError; end

    Identity = Data.define(
      :id,
      :first_name,
      :last_name,
      :username,
      :photo_url,
      :auth_date
    ) do
      def full_name
        [ first_name, last_name ].compact.join(" ").presence
      end

      def to_remnashop(bot_token:, at: Time.current)
        payload = {
          "id" => Integer(id),
          "first_name" => first_name.presence || username.presence || "Telegram",
          "last_name" => last_name.presence,
          "username" => username.presence,
          "photo_url" => photo_url.presence,
          "auth_date" => at.to_i
        }.compact
        payload.merge("hash" => TelegramPayload.signature(payload, bot_token:))
      end
    end

    def self.verify(payload, bot_token:, at: Time.current)
      values = payload.to_h.stringify_keys
      provided = values.delete("hash").to_s
      auth_date = Integer(values["auth_date"], exception: false)
      id = Integer(values["id"], exception: false)
      raise InvalidError unless provided.match?(/\A[0-9a-f]{64}\z/i)
      raise InvalidError unless auth_date && id&.positive?
      raise InvalidError unless (at.to_i - auth_date).between?(0, 24.hours.to_i)

      expected = signature(values, bot_token:)
      raise InvalidError unless
        ActiveSupport::SecurityUtils.secure_compare(expected, provided.downcase)

      Identity.new(
        id: id.to_s,
        first_name: values["first_name"].presence || "Telegram",
        last_name: values["last_name"].presence,
        username: values["username"].presence,
        photo_url: values["photo_url"].presence,
        auth_date:
      )
    end

    def self.signature(payload, bot_token:)
      check_string = payload.to_h.stringify_keys
        .reject { |key, value| key == "hash" || value.blank? }
        .sort
        .map { |key, value| "#{key}=#{value}" }
        .join("\n")
      secret = Digest::SHA256.digest(bot_token)
      OpenSSL::HMAC.hexdigest("SHA256", secret, check_string)
    end
  end
end
