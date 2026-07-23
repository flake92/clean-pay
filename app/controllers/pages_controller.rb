class PagesController < ApplicationController
  layout :page_layout

  before_action :redirect_authenticated_guest_page,
    only: %i[login register]
  before_action :require_session!,
    only: %i[
      register_verify_email
      verify_email
      passkey_setup
    ]
  before_action :require_verified_identity!,
    only: %i[
      cabinet
      payment
      extend
      payment_success
      payment_fail
      payment_pending
      profile
      link_account
    ]

  def home; end
  def login; end
  def register; end
  def register_verify_email; end
  def verify_email; end
  def telegram_webapp; end
  def passkey_setup; end
  def install; end
  def offline; end

  def cabinet
    @subscription = Subscriptions::CurrentAccess.new.call(
      web_session: Current.web_session
    )
    @payments = Current.web_user.payment_records.recent_first.limit(5)
  rescue Subscriptions::CurrentAccess::UrlUnavailableError,
    Subscriptions::CurrentAccess::ContractError
    @subscription_error = true
    @payments ||= Current.web_user.payment_records.recent_first.limit(5)
  end

  def tariffs
    @plans = Subscriptions::Catalog.new.public_plans
  rescue Subscriptions::Catalog::ContractError
    @plans = { "plans" => [] }
    @catalog_error = true
  end

  def payment
    load_offers
    @submission_token = Payments::CreateOperation.issue_submission_token
  end

  def extend
    load_offers
    @submission_token = Payments::CreateOperation.issue_submission_token
  end

  def payment_success = load_payment_hint
  def payment_fail = load_payment_hint
  def payment_pending = load_payment_hint

  def profile
    @passkeys = Current.web_user.web_authn_credentials.order(:created_at)
  end

  def link_account
    @passkeys = Current.web_user.web_authn_credentials.order(:created_at)
  end

  private

  def page_layout
    return "auth" if action_name.in?(%w[
      login
      register
      register_verify_email
      verify_email
      telegram_webapp
      passkey_setup
      install
      offline
    ])

    "application"
  end

  def redirect_authenticated_guest_page
    return unless Current.web_session

    destination =
      if Current.web_session.bootstrap?
        passkey_setup_path
      elsif !Current.web_user.identity_verified?
        verify_email_path
      else
        cabinet_path
      end
    redirect_to destination, status: :see_other
  end

  def load_offers
    @offers = Subscriptions::Catalog.new.offers(
      web_session: Current.web_session
    )
    @offer_version = Payments::CreateOperation.offer_version(@offers)
  rescue Subscriptions::Catalog::ContractError
    raise ErrorHandling::Error.new("UPSTREAM_ERROR", status: :bad_gateway)
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
