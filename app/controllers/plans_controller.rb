class PlansController < ApplicationController
  def index
    @plans = Subscriptions::Catalog.new.public_plans
  rescue Subscriptions::Catalog::ContractError
    raise ErrorHandling::Error.new("UPSTREAM_ERROR", status: :bad_gateway)
  end
end
