module Payments
  class PagesController < ApplicationController
    before_action :require_verified_identity!

    def payment
      load_offers
      @selected_offer = selected_purchase_offer
      @submission_token = CreateOperation.issue_submission_token if
        @selected_offer
    end

    def payment_success = load_payment_hint
    def payment_fail = load_payment_hint
    def payment_pending = load_payment_hint

    private

    def load_offers
      @offers = Subscriptions::Catalog.new.offers(
        web_session: Current.web_session
      )
      @offer_version = CreateOperation.offer_version(@offers)
    rescue Subscriptions::Catalog::ContractError
      raise ErrorHandling::Error.new("UPSTREAM_ERROR", status: :bad_gateway)
    end

    def selected_purchase_offer
      return unless params.values_at(
        :plan_code,
        :duration_days,
        :gateway_type
      ).all?(&:present?)

      matches = offer_entries.select do |entry|
        entry.fetch(:plan)["public_code"].to_s == params[:plan_code] &&
          entry.fetch(:duration)["days"].to_s == params[:duration_days] &&
          entry.fetch(:price)["gateway_type"].to_s == params[:gateway_type]
      end
      matches.one? ? matches.first : nil
    end

    def offer_entries
      Array(@offers["plans"]).flat_map do |plan|
        Array(plan["durations"]).flat_map do |duration|
          Array(duration["prices"]).map do |price|
            { plan:, duration:, price: }
          end
        end
      end
    end

    def load_payment_hint
      operation_id = params[:operation_id].presence ||
        params[:operationId].presence
      payment_id = params[:payment_id].presence ||
        params[:paymentId].presence ||
        params[:order_id].presence ||
        params[:id].presence
      scope = Current.web_user.payment_operations.includes(:payment_record)
      @operation =
        if operation_id
          scope.find_by(id: operation_id)
        elsif payment_id
          scope.joins(:payment_record)
            .find_by(payment_records: { payment_id: })
        end
    end
  end
end
