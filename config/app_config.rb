require "uri"

module CleanPay
  class ConfigurationError < StandardError; end

  class AppConfig
    Secret = Data.define(:value) do
      def inspect = "#<CleanPay::AppConfig::Secret [FILTERED]>"
      def to_s = "[FILTERED]"
      def as_json(*) = "[FILTERED]"
    end

    Urls = Data.define(:app, :public_app)
    Brand = Data.define(:name, :logo_path)
    Storage = Data.define(:database, :redis)
    Remnashop = Data.define(:public_api, :admin_api, :api_key)
    Remnawave = Data.define(:api, :token)
    Security = Data.define(
      :jwt_secret,
      :refresh_secret,
      :audit_ip_hash_secret,
      :rate_limit_identity_secret
    )
    Cookies = Data.define(:secure, :same_site)
    Telegram = Data.define(
      :client_id,
      :client_secret,
      :bot_token,
      :issuer,
      :authorization_endpoint,
      :token_endpoint,
      :jwks_uri
    )
    Turnstile = Data.define(:enabled, :site_key, :secret_key, :verify_url)
    Support = Data.define(:enabled, :email, :telegram_username, :faq_url)
    Readiness = Data.define(:internal_secret, :mailpit_url, :remnawave_url)
    Reconciliation = Data.define(
      :enabled,
      :secret,
      :batch_size,
      :interval_seconds,
      :internal_url
    )
    Retention = Data.define(
      :auth_state_days,
      :session_days,
      :audit_info_days,
      :audit_security_days,
      :rate_limit_days,
      :interval_seconds
    )
    Runtime = Data.define(
      :bind,
      :port,
      :run_migrations,
      :log_level,
      :build_id,
      :build_phase
    )

    attr_reader :urls,
      :brand,
      :storage,
      :remnashop,
      :remnawave,
      :security,
      :cookies,
      :telegram,
      :turnstile,
      :support,
      :readiness,
      :reconciliation,
      :retention,
      :runtime

    def self.load(env: ENV, production: Rails.env.production?)
      Loader.new(env:, production:).load
    end

    def initialize(**attributes)
      attributes.each { |name, value| instance_variable_set(:"@#{name}", value) }
      freeze
    end

    def inspect = "#<CleanPay::AppConfig [FILTERED]>"

    class Loader
      TELEGRAM_ENDPOINTS = {
        issuer: "https://oauth.telegram.org",
        authorization_endpoint: "https://oauth.telegram.org/auth",
        token_endpoint: "https://oauth.telegram.org/token",
        jwks_uri: "https://oauth.telegram.org/.well-known/jwks.json"
      }.freeze
      TURNSTILE_VERIFY_URL =
        "https://challenges.cloudflare.com/turnstile/v0/siteverify"
      LOG_LEVELS = %w[debug info warn error].freeze
      SAME_SITE_VALUES = %w[lax strict none].freeze

      def initialize(env:, production:)
        @env = env
        @production = production
      end

      def load
        config = AppConfig.new(
          urls: urls,
          brand: brand,
          storage: storage,
          remnashop: remnashop,
          remnawave: remnawave,
          security: security,
          cookies: cookies,
          telegram: telegram,
          turnstile: turnstile,
          support: support,
          readiness: readiness,
          reconciliation: reconciliation,
          retention: retention,
          runtime: runtime
        )
        validate_cross_field_rules(config)
        config
      end

      private

      attr_reader :env, :production

      def urls
        app = url(
          "APP_URL",
          default: "http://localhost:4000",
          schemes: production ? %w[https] : %w[http https],
          origin_only: true
        )
        public_app = url(
          "NEXT_PUBLIC_APP_URL",
          default: app.to_s,
          schemes: production ? %w[https] : %w[http https],
          origin_only: true
        )
        Urls.new(app:, public_app:)
      end

      def brand
        name = string("NEXT_PUBLIC_BRAND_NAME", default: "Clean Pay", max: 80)
        logo_path =
          string("NEXT_PUBLIC_BRAND_LOGO_URL", default: "/clean-pay-logo.png")
        unless logo_path.start_with?("/") &&
            !logo_path.start_with?("//") &&
            !logo_path.match?(/[\\\0]/)
          invalid!("NEXT_PUBLIC_BRAND_LOGO_URL must be a safe root-relative path")
        end
        Brand.new(name:, logo_path:)
      end

      def storage
        database = url(
          "DATABASE_URL",
          default: "postgresql://clean_pay:clean_pay@127.0.0.1:5432/clean_pay",
          required: production,
          schemes: %w[postgres postgresql]
        )
        redis = url(
          "REDIS_URL",
          default: "redis://127.0.0.1:6379/0",
          required: production,
          schemes: %w[redis rediss]
        )
        Storage.new(database:, redis:)
      end

      def remnashop
        public_api = url(
          "REMNASHOP_API_BASE_URL",
          default: "http://localhost:5001/api/v1/public",
          required: production,
          schemes: production ? %w[https] : %w[http https]
        )
        unless public_api.path.end_with?("/api/v1/public")
          invalid!("REMNASHOP_API_BASE_URL must end with /api/v1/public")
        end

        derived_admin = public_api.dup
        derived_admin.path = public_api.path.sub(%r{/public\z}, "/admin")
        admin_api = url(
          "REMNASHOP_ADMIN_API_BASE_URL",
          default: derived_admin.to_s,
          schemes: production ? %w[https] : %w[http https]
        )
        unless admin_api.origin == public_api.origin &&
            admin_api.path.end_with?("/api/v1/admin")
          invalid!("REMNASHOP_ADMIN_API_BASE_URL must share origin and end with /api/v1/admin")
        end

        Remnashop.new(
          public_api:,
          admin_api:,
          api_key: secret("REMNASHOP_API_KEY", required: production, min: 24)
        )
      end

      def remnawave
        api_value = optional_string("REMNAWAVE_API_BASE_URL")
        token_value = optional_string("REMNAWAVE_TOKEN")
        if production || api_value || token_value
          invalid!("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN must be configured together") unless api_value && token_value
        end

        api = api_value && parse_url(
          "REMNAWAVE_API_BASE_URL",
          api_value,
          schemes: production ? %w[https] : %w[http https],
          origin_only: true
        )
        token = token_value && Secret.new(validate_secret!("REMNAWAVE_TOKEN", token_value, 24))
        Remnawave.new(api:, token:)
      end

      def security
        Security.new(
          jwt_secret: secret("WEB_JWT_SECRET", required: production, min: 32),
          refresh_secret: secret("WEB_REFRESH_SECRET", required: production, min: 32),
          audit_ip_hash_secret:
            secret("AUDIT_IP_HASH_SECRET", required: production, min: 32),
          rate_limit_identity_secret:
            secret("RATE_LIMIT_IDENTITY_SECRET", required: production, min: 32)
        )
      end

      def cookies
        secure = boolean("COOKIE_SECURE", default: production)
        same_site = enum("COOKIE_SAMESITE", SAME_SITE_VALUES, default: "lax").to_sym
        invalid!("COOKIE_SAMESITE=none requires COOKIE_SECURE=true") if same_site == :none && !secure
        invalid!("COOKIE_SECURE must be true in production") if production && !secure
        Cookies.new(secure:, same_site:)
      end

      def telegram
        client_id = optional_string("TELEGRAM_OIDC_CLIENT_ID")
        if production && !client_id&.match?(/\A[1-9]\d{4,19}\z/)
          invalid!("TELEGRAM_OIDC_CLIENT_ID must be a 5..20 digit bot id")
        end

        endpoints = TELEGRAM_ENDPOINTS.dup
        TELEGRAM_ENDPOINTS.each_key do |key|
          name = "TELEGRAM_OIDC_#{key.to_s.upcase}"
          value = optional_string(name)
          if production && value && value != TELEGRAM_ENDPOINTS.fetch(key)
            invalid!("#{name} cannot override the official production endpoint")
          end
          endpoints[key] = value || TELEGRAM_ENDPOINTS.fetch(key)
        end

        bot_token = secret("TELEGRAM_BOT_TOKEN", required: production, min: 32)
        if production && bot_token && client_id &&
            !bot_token.value.match?(/\A#{Regexp.escape(client_id)}:.{20,}\z/)
          invalid!("TELEGRAM_BOT_TOKEN must start with the configured client id")
        end

        Telegram.new(
          client_id:,
          client_secret:
            secret("TELEGRAM_OIDC_CLIENT_SECRET", required: production, min: 24),
          bot_token:,
          issuer: parse_url("TELEGRAM_OIDC_ISSUER", endpoints[:issuer], schemes: %w[http https]),
          authorization_endpoint:
            parse_url("TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT",
              endpoints[:authorization_endpoint], schemes: %w[http https]),
          token_endpoint:
            parse_url("TELEGRAM_OIDC_TOKEN_ENDPOINT",
              endpoints[:token_endpoint], schemes: %w[http https]),
          jwks_uri:
            parse_url("TELEGRAM_OIDC_JWKS_URI", endpoints[:jwks_uri], schemes: %w[http https])
        )
      end

      def turnstile
        enabled = boolean("TURNSTILE_ENABLED", default: false)
        site_key = optional_string("TURNSTILE_SITE_KEY")
        secret_key = secret("TURNSTILE_SECRET_KEY", min: production ? 24 : 1)
        invalid!("Turnstile keys are required when enabled") if enabled && (!site_key || !secret_key)

        verify_url = url(
          "TURNSTILE_VERIFY_URL",
          default: TURNSTILE_VERIFY_URL,
          schemes: production ? %w[https] : %w[http https]
        )
        if production && verify_url.to_s != TURNSTILE_VERIFY_URL
          invalid!("TURNSTILE_VERIFY_URL must be the official endpoint in production")
        end
        Turnstile.new(enabled:, site_key:, secret_key:, verify_url:)
      end

      def support
        enabled = boolean("SUPPORT_ENABLED", default: false)
        email = optional_string("SUPPORT_EMAIL")
        username = optional_string("SUPPORT_TELEGRAM_USERNAME")
        faq_url = optional_string("SUPPORT_FAQ_URL")
        invalid!("SUPPORT_EMAIL is invalid") if email && !URI::MailTo::EMAIL_REGEXP.match?(email)
        if username && !username.match?(/\A@?[A-Za-z][A-Za-z0-9_]{4,31}\z/)
          invalid!("SUPPORT_TELEGRAM_USERNAME is invalid")
        end
        faq = faq_url && parse_url("SUPPORT_FAQ_URL", faq_url, schemes: %w[https])
        Support.new(enabled:, email:, telegram_username: username, faq_url: faq)
      end

      def readiness
        mailpit = optional_string("CLEAN_PAY_READINESS_MAILPIT_URL")
        remnawave_url = optional_string("CLEAN_PAY_READINESS_REMNAWAVE_URL")
        Readiness.new(
          internal_secret:
            secret("READINESS_INTERNAL_SECRET", required: production, min: 32),
          mailpit_url:
            mailpit && parse_url("CLEAN_PAY_READINESS_MAILPIT_URL", mailpit,
              schemes: production ? %w[https] : %w[http https], origin_only: true),
          remnawave_url:
            remnawave_url && parse_url("CLEAN_PAY_READINESS_REMNAWAVE_URL",
              remnawave_url, schemes: production ? %w[https] : %w[http https],
              origin_only: true)
        )
      end

      def reconciliation
        enabled = boolean("PAYMENT_RECONCILIATION_ENABLED", default: false)
        secret_value =
          secret("PAYMENT_RECONCILIATION_SECRET", required: enabled, min: 32)
        internal = optional_string("PAYMENT_RECONCILIATION_INTERNAL_URL")
        invalid!("PAYMENT_RECONCILIATION_INTERNAL_URL is required when enabled") if enabled && !internal
        Reconciliation.new(
          enabled:,
          secret: secret_value,
          batch_size:
            integer("PAYMENT_RECONCILIATION_BATCH_SIZE", default: 10, range: 1..100),
          interval_seconds:
            integer("PAYMENT_RECONCILIATION_INTERVAL_SECONDS",
              default: 30, range: 5..3600),
          internal_url:
            internal && parse_url("PAYMENT_RECONCILIATION_INTERNAL_URL", internal,
              schemes: production ? %w[https] : %w[http https])
        )
      end

      def retention
        Retention.new(
          auth_state_days:
            integer("AUTH_STATE_RETENTION_DAYS", default: 7, range: 1..30),
          session_days:
            integer("SESSION_RETENTION_DAYS", default: 90, range: 30..365),
          audit_info_days:
            integer("AUDIT_INFO_RETENTION_DAYS", default: 180, range: 30..730),
          audit_security_days:
            integer("AUDIT_SECURITY_RETENTION_DAYS", default: 365, range: 90..2555),
          rate_limit_days:
            integer("RATE_LIMIT_RETENTION_DAYS", default: 30, range: 1..180),
          interval_seconds:
            integer("DATA_RETENTION_INTERVAL_SECONDS",
              default: 21_600, range: 300..86_400)
        )
      end

      def runtime
        bind = string("CLEAN_PAY_BIND", default: production ? "127.0.0.1" : "0.0.0.0")
        if production && !%w[127.0.0.1 ::1].include?(bind)
          invalid!("CLEAN_PAY_BIND must be loopback in production")
        end
        build_phase = boolean("CLEAN_PAY_BUILD_PHASE", default: false)
        Runtime.new(
          bind:,
          port: integer("CLEAN_PAY_PORT", default: 4000, range: 4000..4000),
          run_migrations: boolean("RUN_MIGRATIONS", default: true),
          log_level: enum("LOG_LEVEL", LOG_LEVELS, default: "info").to_sym,
          build_id: optional_string("CLEAN_PAY_BUILD_ID") ||
            optional_string("GITHUB_SHA"),
          build_phase:
        )
      end

      def validate_cross_field_rules(config)
        if production && config.urls.app.origin != config.urls.public_app.origin
          invalid!("APP_URL and NEXT_PUBLIC_APP_URL must have the same production origin")
        end
        if config.retention.audit_security_days < config.retention.audit_info_days
          invalid!("AUDIT_SECURITY_RETENTION_DAYS must be >= AUDIT_INFO_RETENTION_DAYS")
        end

        secrets = [
          config.remnashop.api_key,
          config.remnawave.token,
          *config.security.deconstruct,
          config.telegram.client_secret,
          config.telegram.bot_token,
          config.readiness.internal_secret,
          config.reconciliation.secret
        ].compact.map(&:value)
        if production && secrets.uniq.size != secrets.size
          invalid!("production secrets must be pairwise distinct")
        end
      end

      def optional_string(name)
        value = env[name]
        return if value.nil? || value.empty?

        invalid!("#{name} must not contain surrounding whitespace") if value != value.strip
        value
      end

      def string(name, default: nil, required: false, max: nil)
        value = optional_string(name) || default
        invalid!("#{name} is required") if required && !value
        invalid!("#{name} must not exceed #{max} characters") if max && value.length > max
        value
      end

      def boolean(name, default:)
        value = optional_string(name)
        return default if value.nil?
        return true if value == "true"
        return false if value == "false"

        invalid!("#{name} must be exactly true or false")
      end

      def integer(name, default:, range:)
        raw = optional_string(name)
        value = raw ? Integer(raw, 10) : default
        invalid!("#{name} must be within #{range}") unless range.cover?(value)
        value
      rescue ArgumentError
        invalid!("#{name} must be an integer")
      end

      def enum(name, values, default:)
        value = optional_string(name) || default
        invalid!("#{name} must be one of #{values.join(", ")}") unless values.include?(value)
        value
      end

      def secret(name, required: false, min: 1)
        value = optional_string(name)
        invalid!("#{name} is required") if required && !value
        return unless value

        Secret.new(validate_secret!(name, value, min))
      end

      def validate_secret!(name, value, min)
        invalid!("#{name} must contain at least #{min} characters") if value.length < min
        if production && value.match?(/(?:change.?me|placeholder|example|password|secret)\z/i)
          invalid!("#{name} uses a forbidden weak value")
        end
        value
      end

      def url(name, default: nil, required: false, schemes:, origin_only: false)
        value = string(name, default:, required:)
        return unless value

        parse_url(name, value, schemes:, origin_only:)
      end

      def parse_url(name, value, schemes:, origin_only: false)
        uri = URI.parse(value)
        invalid!("#{name} must use #{schemes.join(" or ")}") unless schemes.include?(uri.scheme)
        invalid!("#{name} must include a host") unless uri.host
        if origin_only && (uri.path.present? && uri.path != "/" || uri.query || uri.fragment || uri.userinfo)
          invalid!("#{name} must be an origin without path, query, fragment, or credentials")
        end
        uri
      rescue URI::InvalidURIError
        invalid!("#{name} must be a valid URL")
      end

      def invalid!(message)
        raise ConfigurationError, message
      end
    end
  end
end
