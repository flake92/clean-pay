module Payments
  class CreateOperation
    class ValidationError < StandardError; end
    class IdempotencyConflictError < StandardError; end
    class OfferChangedError < StandardError; end

    Result = Data.define(:operation, :payment, :replayed)

    def initialize(client: Integrations::RemnashopClient.new)
      @client = client
    end

    def self.issue_submission_token
      submission_verifier.generate(
        { "nonce" => SecureRandom.uuid },
        purpose: "payment-submission",
        expires_in: 30.minutes
      )
    end

    def self.offer_version(offers)
      Digest::SHA256.hexdigest(JSON.generate(canonical(offers)))
    end

    def call!(kind:, web_session:, params:, submission_token:)
      token = access_token!(web_session)
      command = validate_command!(kind:, params:)
      identity = operation_identity(
        kind:,
        command:,
        submission_token:
      )
      replay = replay_operation(
        web_user: web_session.web_user,
        identity:
      )
      return result_for(replay, replayed: true) if replay

      fresh_offers = client.offers(access_token: token)
      offer = resolve_offer!(kind:, command:, offers: fresh_offers)
      operation, replayed = acquire_operation!(
        kind:,
        web_user: web_session.web_user,
        command:,
        identity:
      )
      return result_for(operation, replayed: true) if replayed
      return result_for(operation, replayed: false) unless operation.claim_dispatch!

      dispatch!(operation:, web_session:, command:, offer:)
    end

    class << self
      private

      def submission_verifier
        @submission_verifier ||= ActiveSupport::MessageVerifier.new(
          Rails.application.key_generator.generate_key(
            "payment-submission",
            32
          ),
          digest: "SHA256",
          serializer: JSON,
          url_safe: true
        )
      end

      def canonical(value)
        case value
        when Hash
          value.to_h.stringify_keys.sort.to_h.transform_values {
            canonical(_1)
          }
        when Array then value.map { canonical(_1) }
        else value
        end
      end
    end

    private

    attr_reader :client

    def validate_command!(kind:, params:)
      values = params.to_h.stringify_keys.slice(
        "plan_code",
        "duration_days",
        "gateway_type",
        "confirmed_amount",
        "confirmed_currency",
        "offer_version"
      )
      duration = Integer(values["duration_days"], exception: false)
      amount = values["confirmed_amount"].to_s
      currency = values["confirmed_currency"].to_s
      gateway = values["gateway_type"].to_s
      version = values["offer_version"].to_s
      plan_code = values["plan_code"].to_s
      valid = duration&.between?(0, 365_000) &&
        gateway.length.between?(1, 100) &&
        amount.match?(/\A(?:0|[1-9]\d*)(?:\.\d{1,8})?\z/) &&
        amount.length <= 64 &&
        currency.match?(/\A[A-Z0-9]{2,12}\z/) &&
        version.length.between?(1, 2048) &&
        (kind.to_sym == :extend || plan_code.length.between?(1, 200))
      raise ValidationError unless valid

      values.merge(
        "duration_days" => duration,
        "gateway_type" => gateway,
        "confirmed_amount" => amount,
        "confirmed_currency" => currency,
        "offer_version" => version,
        "plan_code" => plan_code
      )
    end

    def resolve_offer!(kind:, command:, offers:)
      raise ValidationError unless offers.is_a?(Hash)
      raise OfferChangedError unless
        self.class.offer_version(offers) == command.fetch("offer_version")

      plans = Array(offers["plans"])
      candidates =
        if kind.to_sym == :purchase
          plans.select {
            _1["public_code"].to_s == command.fetch("plan_code")
          }
        else
          plans.select {
            _1["recommended_purchase_type"].to_s.casecmp?("renew")
          }
        end
      matches = candidates.filter_map do |plan|
        duration = Array(plan["durations"]).find {
          Integer(_1["days"], exception: false) ==
            command.fetch("duration_days")
        }
        next unless duration

        price = Array(duration["prices"]).find {
          _1["gateway_type"].to_s == command.fetch("gateway_type")
        }
        next unless price
        next unless price["final_amount"].to_s ==
          command.fetch("confirmed_amount")
        next unless price["currency"].to_s ==
          command.fetch("confirmed_currency")

        { plan:, duration:, price: }
      end
      raise OfferChangedError unless matches.one?

      matches.first
    end

    def operation_identity(kind:, command:, submission_token:)
      nonce = verified_nonce!(submission_token)
      {
        digest: OpenSSL::HMAC.hexdigest(
          "SHA256",
          idempotency_secret,
          nonce
        ),
        fingerprint: Digest::SHA256.hexdigest(
          JSON.generate(
            self.class.send(:canonical, command.merge("kind" => kind.to_s))
          )
        )
      }
    end

    def replay_operation(web_user:, identity:)
      existing = web_user.payment_operations.find_by(
        idempotency_key_hash: identity.fetch(:digest)
      )
      return unless existing
      raise IdempotencyConflictError unless
        existing.request_fingerprint == identity.fetch(:fingerprint)

      existing
    end

    def acquire_operation!(kind:, web_user:, command:, identity:)
      web_user.with_lock do
        existing = replay_operation(web_user:, identity:)
        return [ existing, true ] if existing

        enforce_submission_limit!(web_user)
        operation = web_user.payment_operations.create!(
          kind:,
          idempotency_key_hash: identity.fetch(:digest),
          request_fingerprint: identity.fetch(:fingerprint),
          request_payload: command,
          upstream_key: SecureRandom.uuid,
          upstream_owner_hash: owner_hash(web_user)
        )
        [ operation, false ]
      end
    end

    def dispatch!(operation:, web_session:, command:, offer:)
      return_url = URI.join(
        Rails.application.config.x.clean_pay.urls.app.to_s,
        "/payment/pending?operation_id=#{operation.id}"
      ).to_s
      payload = {
        duration_days: command.fetch("duration_days"),
        gateway_type: command.fetch("gateway_type"),
        return_url:
      }
      payload[:plan_code] = command.fetch("plan_code") if operation.purchase?
      body =
        if operation.purchase?
          client.purchase(
            access_token: web_session.remnashop_access_token,
            idempotency_key: operation.upstream_key,
            payload:
          )
        else
          client.extend_subscription(
            access_token: web_session.remnashop_access_token,
            idempotency_key: operation.upstream_key,
            payload:
          )
        end
      settle_success!(
        operation:,
        body:,
        command:,
        offer:,
        return_url:
      )
    rescue Integrations::RemnashopClient::Error => error
      snapshot = { "code" => error.code, "status" => error.status }
      if error.status >= 500
        operation.mark_outcome_unknown!(snapshot:)
      else
        operation.settle_failure!(snapshot:)
      end
      result_for(operation.reload, replayed: false)
    rescue ValidationError
      operation.mark_outcome_unknown!(
        snapshot: { "code" => "UPSTREAM_ERROR" }
      )
      result_for(operation.reload, replayed: false)
    end

    def settle_success!(operation:, body:, command:, offer:, return_url:)
      values = validate_payment_response!(body, return_url:)
      record_attributes = values.merge(
        "gateway_type" => command.fetch("gateway_type"),
        "plan_id" => offer.fetch(:plan)["id"],
        "plan_name" => offer.fetch(:plan)["name"],
        "duration_days" => command.fetch("duration_days")
      )
      payment = nil
      PaymentOperation.transaction do
        payment = PaymentRecord.upsert_upstream!(
          web_user: operation.web_user,
          attributes: record_attributes,
          payment_operation: operation
        )
        operation.settle_success!(
          snapshot: {
            "payment_id" => payment.payment_id,
            "status" => payment.status
          }
        )
      end
      Result.new(operation:, payment:, replayed: false)
    end

    def validate_payment_response!(body, return_url:)
      raise ValidationError unless body.is_a?(Hash)

      values = body.stringify_keys
      IdempotencyKey.parse(values.fetch("payment_id"))
      amount = MoneyAmount.parse(values.fetch("final_amount"))
      raise ValidationError unless
        %w[NEW RENEW CHANGE].include?(
          values.fetch("purchase_type").to_s.upcase
        )
      raise ValidationError unless
        %w[PENDING COMPLETED FAILED CANCELED REFUNDED].include?(
          values.fetch("status").to_s.upcase
        )
      raise ValidationError unless values["is_free"] == amount.to_d.zero?
      raise ValidationError if values["return_url"].present? &&
        values["return_url"] != return_url

      values.merge(
        "final_amount" => amount.to_s,
        "payment_url" =>
          PaymentRecord.safe_payment_url(values["payment_url"])
      )
    rescue KeyError, ActiveModel::ValidationError, URI::InvalidURIError
      raise ValidationError
    end

    def result_for(operation, replayed:)
      Result.new(
        operation:,
        payment: operation.payment_record,
        replayed:
      )
    end

    def verified_nonce!(token)
      payload = self.class.send(:submission_verifier).verify(
        token,
        purpose: "payment-submission"
      )
      IdempotencyKey.parse(payload.fetch("nonce")).value
    rescue ActiveSupport::MessageVerifier::InvalidSignature,
      KeyError,
      ActiveModel::ValidationError
      raise ValidationError
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
      OpenSSL::HMAC.hexdigest(
        "SHA256",
        idempotency_secret,
        web_user.remnashop_user_id.to_s
      )
    end

    def enforce_submission_limit!(web_user, at: Time.current)
      key = owner_hash(web_user)
      action = "payment_submission"
      if RateLimitEvent.where(
        key:,
        action:,
        occurred_at: 15.minutes.ago(at)..
      ).count >= 10
        raise ErrorHandling::Error.new(
          "RATE_LIMITED",
          status: :too_many_requests
        )
      end

      RateLimitEvent.create!(
        key:,
        action:,
        occurred_at: at,
        metadata: { "web_user_id" => web_user.id }
      )
    end

    def idempotency_secret
      config = Rails.application.config.x.clean_pay
      config.security.rate_limit_identity_secret&.value ||
        Rails.application.key_generator.generate_key(
          "payment-idempotency",
          32
        )
    end
  end
end
