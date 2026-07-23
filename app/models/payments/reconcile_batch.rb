module Payments
  class ReconcileBatch
    Result = Data.define(
      :claimed,
      :succeeded,
      :deferred,
      :manual_required,
      :failed
    )

    def initialize(client: Integrations::RemnashopClient.new)
      @client = client
    end

    def call!(limit:, deadline: 12.seconds.from_now)
      counters = {
        claimed: 0,
        succeeded: 0,
        deferred: 0,
        manual_required: 0,
        failed: 0
      }
      candidates(limit:).each do |operation|
        break if Time.current >= deadline

        reconcile(operation, counters:)
      end
      Result.new(**counters)
    end

    private

    attr_reader :client

    def candidates(limit:)
      PaymentOperation.reconcilable.order(:reconciliation_next_at, :id)
        .limit(limit)
    end

    def reconcile(operation, counters:)
      claim = operation.claim_reconciliation!
      return unless claim

      counters[:claimed] += 1
      session = operation.web_user.web_sessions.active
        .where.not(remnashop_access_token: nil)
        .order(updated_at: :desc)
        .first
      unless session
        operation.require_manual_review!(
          claim:,
          snapshot: { "reason" => "missing_upstream_session" }
        )
        counters[:manual_required] += 1
        return
      end

      response = client.payment_recovery(
        access_token: session.remnashop_access_token,
        operation: operation.kind.upcase,
        idempotency_key: operation.upstream_key
      )
      settle_recovery(operation, response, claim:, counters:)
    rescue PaymentOperation::StaleClaimError
      nil
    rescue Integrations::RemnashopClient::Error => error
      operation.defer_reconciliation!(
        claim:,
        error: { "code" => error.code, "status" => error.status }
      )
      counters[:failed] += 1
    rescue StandardError => error
      operation.defer_reconciliation!(
        claim:,
        error: { "class" => error.class.name }
      )
      counters[:failed] += 1
    end

    def settle_recovery(operation, response, claim:, counters:)
      values = response.to_h.stringify_keys
      raise KeyError unless values["operation"] == operation.kind.upcase

      case values["state"]
      when "SUCCEEDED"
        settle_success(operation, values, claim:)
        counters[:succeeded] += 1
      when "IN_PROGRESS", "UNKNOWN"
        operation.defer_reconciliation!(
          claim:,
          delay: Integer(
            values["retry_after_seconds"] || 5,
            exception: false
          )&.seconds || 5.seconds
        )
        counters[:deferred] += 1
      when "MANUAL_REQUIRED"
        operation.require_manual_review!(claim:, snapshot: values)
        counters[:manual_required] += 1
      else
        raise KeyError
      end
    end

    def settle_success(operation, values, claim:)
      payment = values.fetch("payment").to_h.stringify_keys
      transaction = PaymentRecord.validate_transaction!(
        values.fetch("transaction")
      )
      raise KeyError unless payment["payment_id"] == transaction["payment_id"]
      %w[purchase_type status final_amount currency].each do |key|
        raise KeyError unless payment.fetch(key).to_s.casecmp?(
          transaction.fetch(key).to_s
        )
      end
      amount = MoneyAmount.parse(payment.fetch("final_amount"))
      raise KeyError unless payment["is_free"].in?([ true, false ])
      raise KeyError unless payment["is_free"] == amount.to_d.zero?

      PaymentOperation.transaction do
        PaymentRecord.upsert_upstream!(
          web_user: operation.web_user,
          attributes: transaction.merge(
            "payment_url" => payment["payment_url"],
            "is_free" => payment["is_free"]
          ),
          payment_operation: operation
        )
        operation.settle_recovered_success!(
          claim:,
          snapshot: {
            "payment_id" => payment.fetch("payment_id"),
            "recovered" => true
          }
        )
      end
    end
  end
end
