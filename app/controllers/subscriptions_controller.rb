class SubscriptionsController < ApplicationController
  before_action :require_verified_identity!

  def show
    @subscription = Subscriptions::CurrentAccess.new.call(
      web_session: Current.web_session
    )
  rescue Subscriptions::CurrentAccess::UrlUnavailableError
    raise ErrorHandling::Error.new(
      "CONFLICT",
      status: :conflict,
      message: "Не удалось подтвердить актуальную ссылку подписки."
    )
  rescue Subscriptions::CurrentAccess::ContractError
    raise ErrorHandling::Error.new("UPSTREAM_ERROR", status: :bad_gateway)
  end

  def offers
    @offers = Subscriptions::Catalog.new.offers(
      web_session: Current.web_session
    )
  rescue Subscriptions::Catalog::ContractError
    raise ErrorHandling::Error.new("UPSTREAM_ERROR", status: :bad_gateway)
  end

  def reissue
    Subscriptions::AccountActions.new.reissue(
      web_session: Current.web_session
    )
    redirect_to subscription_path,
      notice: "Ссылка подписки перевыпущена.",
      status: :see_other
  end

  def promocode
    code = params.expect(promocode: [ :code ]).fetch(:code)
    Subscriptions::AccountActions.new.activate_promocode(
      web_session: Current.web_session,
      code:
    )
    redirect_to subscription_path,
      notice: "Промокод применён.",
      status: :see_other
  end
end
