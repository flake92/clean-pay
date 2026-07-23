module Subscriptions
  class PagesController < ApplicationController
    before_action :require_verified_identity!

    def cabinet
      @subscription = CurrentAccess.new.call(
        web_session: Current.web_session
      )
      @payments = Current.web_user.payment_records.recent_first.limit(5)
    rescue CurrentAccess::UrlUnavailableError, CurrentAccess::ContractError
      @subscription_error = true
      @payments ||= Current.web_user.payment_records.recent_first.limit(5)
    end

    def tariffs
      @plans = Catalog.new.public_plans
    rescue Catalog::ContractError
      @plans = { "plans" => [] }
      @catalog_error = true
    end

    def extend
      @subscription = CurrentAccess.new.call(
        web_session: Current.web_session
      )
      return unless @subscription

      load_offers
      @renewal_offers = offer_entries.select {
        _1.fetch(:plan)["recommended_purchase_type"].to_s.casecmp?("renew")
      }
      @submission_token = Payments::CreateOperation.issue_submission_token if
        @renewal_offers.any?
    rescue CurrentAccess::UrlUnavailableError, CurrentAccess::ContractError
      @subscription_error = true
    end

    private

    def load_offers
      @offers = Catalog.new.offers(web_session: Current.web_session)
      @offer_version = Payments::CreateOperation.offer_version(@offers)
    rescue Catalog::ContractError
      raise ErrorHandling::Error.new("UPSTREAM_ERROR", status: :bad_gateway)
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
  end
end
